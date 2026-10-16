import { createHash, createHmac } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../env.js";

// Private object storage (T-052): the bytes of a file. "local" is a folder, for development and tests; "r2" is a
// Cloudflare R2 bucket, spoken to over its S3 API with AWS Signature V4 (no SDK package is needed). Nothing here
// hands out a public address: the API reads the bytes and serves them behind its own signed link.

export type FileStorage = {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
};

/**
 * What the backups need on top (M9.4b, A-318): a file sent and fetched as a stream, so a dump of any size never sits in
 * memory. `sha256` and `bytes` are the file's, known from writing it; R2 checks the hash it is signed with.
 */
export type StreamingStorage = FileStorage & {
  putFile(key: string, path: string, contentType: string, file: { bytes: number; sha256: string }): Promise<void>;
  getToFile(key: string, path: string): Promise<void>;
};

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** The headers of a Signature V4 request to an S3-compatible endpoint (path style), for `now`. Exported for tests. */
export function signedRequest(input: {
  method: "GET" | "PUT";
  host: string;
  path: string;
  body: Buffer;
  /** The body's SHA-256 (hex) when the body is streamed and not in `body`. */
  payloadHash?: string;
  contentType?: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  now: Date;
}): Record<string, string> {
  const amzDate = input.now
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}/, "");
  const day = amzDate.slice(0, 8);
  const payloadHash = input.payloadHash ?? sha256Hex(input.body);
  const headers: Record<string, string> = {
    host: input.host,
    "x-amz-content-sha256": payloadHash,
    "x-amz-date": amzDate,
    ...(input.contentType ? { "content-type": input.contentType } : {}),
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((name) => `${name}:${headers[name]}\n`).join("");
  const signedHeaders = names.join(";");
  const canonical = [input.method, input.path, "", canonicalHeaders, signedHeaders, payloadHash].join("\n");
  const scope = `${day}/${input.region}/s3/aws4_request`;
  const toSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256Hex(canonical)].join("\n");
  const signingKey = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, day), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", signingKey).update(toSign).digest("hex");
  headers.authorization = `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return headers;
}

function r2Storage(bucket: string): StreamingStorage {
  // R2_ENDPOINT only for a stand-in S3 server in tests (MinIO); R2 itself is reached by the account's host.
  const origin = new URL(env.R2_ENDPOINT ?? `https://${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`);
  const pathOf = (key: string) => `/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const signed = (
    method: "GET" | "PUT",
    path: string,
    body: Buffer,
    extra: { contentType?: string; payloadHash?: string },
  ) => {
    const headers = signedRequest({
      method,
      host: origin.host,
      path,
      body,
      ...extra,
      region: "auto",
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      now: new Date(),
    });
    delete headers.host;
    return headers;
  };
  const call = (method: "GET" | "PUT", key: string, body: Buffer, contentType?: string) => {
    const path = pathOf(key);
    return fetch(`${origin.origin}${path}`, {
      method,
      headers: signed(method, path, body, { contentType }),
      body: method === "PUT" ? new Uint8Array(body) : undefined,
    });
  };
  return {
    async putFile(key, file, contentType, { bytes, sha256 }) {
      const path = pathOf(key);
      const response = await fetch(`${origin.origin}${path}`, {
        method: "PUT",
        headers: {
          ...signed("PUT", path, Buffer.alloc(0), { contentType, payloadHash: sha256 }),
          "content-length": String(bytes),
        },
        body: Readable.toWeb(createReadStream(file)) as ReadableStream,
        duplex: "half",
      } as RequestInit);
      if (!response.ok) throw new Error(`R2 put failed: ${response.status}`);
    },
    async getToFile(key, file) {
      const response = await call("GET", key, Buffer.alloc(0));
      if (!response.ok || !response.body) throw new Error(`R2 get failed: ${response.status}`);
      await pipeline(Readable.fromWeb(response.body as WebReadableStream), createWriteStream(file));
    },
    async put(key, bytes, contentType) {
      const response = await call("PUT", key, bytes, contentType);
      if (!response.ok) throw new Error(`R2 put failed: ${response.status}`);
    },
    async get(key) {
      const response = await call("GET", key, Buffer.alloc(0));
      if (!response.ok) throw new Error(`R2 get failed: ${response.status}`);
      return Buffer.from(await response.arrayBuffer());
    },
  };
}

function localStorage(folder: string): StreamingStorage {
  const root = resolve(folder);
  const pathOf = (key: string) => {
    const full = resolve(join(root, key));
    // A key is generated here, but a path outside the folder is never read or written.
    if (!full.startsWith(root + sep)) throw new Error("Storage key outside the storage folder");
    return full;
  };
  return {
    async put(key, bytes) {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      await writeFile(full, bytes);
    },
    get: (key) => readFile(pathOf(key)),
    async putFile(key, file) {
      const full = pathOf(key);
      await mkdir(dirname(full), { recursive: true });
      await copyFile(file, full);
    },
    getToFile: (key, file) => copyFile(pathOf(key), file),
  };
}

export const fileStorage: FileStorage =
  env.FILE_STORAGE === "r2" ? r2Storage(env.R2_BUCKET!) : localStorage(env.FILE_STORAGE_DIR);

/**
 * Where the database backups go (M9.4b, A-312): their own bucket when BACKUP_R2_BUCKET is set (recommended: its own
 * lifecycle rule and keys), else the files' bucket; on a developer's machine, the folder above the files (keys start with `backups/`).
 */
export const backupStorage: StreamingStorage =
  env.FILE_STORAGE === "r2"
    ? r2Storage(env.BACKUP_R2_BUCKET ?? env.R2_BUCKET!)
    : localStorage(join(env.FILE_STORAGE_DIR, ".."));
