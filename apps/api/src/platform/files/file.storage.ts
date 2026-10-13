import { createHash, createHmac } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";
import { env } from "../env.js";

// Private object storage (T-052): the bytes of a file. "local" is a folder, for development and tests; "r2" is a
// Cloudflare R2 bucket, spoken to over its S3 API with AWS Signature V4 (no SDK package is needed). Nothing here
// hands out a public address: the API reads the bytes and serves them behind its own signed link.

export type FileStorage = {
  put(key: string, bytes: Buffer, contentType: string): Promise<void>;
  get(key: string): Promise<Buffer>;
};

const sha256Hex = (data: Buffer | string) => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string) => createHmac("sha256", key).update(data).digest();

/** The headers of a Signature V4 request to an S3-compatible endpoint (path style), for `now`. Exported for tests. */
export function signedRequest(input: {
  method: "GET" | "PUT";
  host: string;
  path: string;
  body: Buffer;
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
  const payloadHash = sha256Hex(input.body);
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

function r2Storage(): FileStorage {
  const host = `${env.R2_ACCOUNT_ID}.r2.cloudflarestorage.com`;
  const pathOf = (key: string) => `/${env.R2_BUCKET}/${key.split("/").map(encodeURIComponent).join("/")}`;
  const call = (method: "GET" | "PUT", key: string, body: Buffer, contentType?: string) => {
    const path = pathOf(key);
    const headers = signedRequest({
      method,
      host,
      path,
      body,
      contentType,
      region: "auto",
      accessKeyId: env.R2_ACCESS_KEY_ID!,
      secretAccessKey: env.R2_SECRET_ACCESS_KEY!,
      now: new Date(),
    });
    delete headers.host;
    return fetch(`https://${host}${path}`, {
      method,
      headers,
      body: method === "PUT" ? new Uint8Array(body) : undefined,
    });
  };
  return {
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

function localStorage(): FileStorage {
  const root = resolve(env.FILE_STORAGE_DIR);
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
  };
}

export const fileStorage: FileStorage = env.FILE_STORAGE === "r2" ? r2Storage() : localStorage();
