import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// Sensitive personal data at rest (D-042, T-052): ID document numbers and health notes
// are encrypted in the application with AES-256-GCM before they reach the database, so
// a database dump or backup alone never reveals them. Stored form:
//   v1:<base64 of 12-byte IV | 16-byte auth tag | ciphertext>
// The version names the key, so a later key can be added for rotation. Values are never
// logged, plain or encrypted.

const VERSION = "v1";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export type FieldKey = Buffer;

/** The key from FIELD_ENCRYPTION_KEY: 32 bytes, base64. */
export function parseFieldKey(base64: string): FieldKey {
  const key = Buffer.from(base64, "base64");
  if (key.length !== 32) throw new Error("FIELD_ENCRYPTION_KEY must be 32 bytes, base64-encoded");
  return key;
}

export function encryptField(key: FieldKey, plain: string): string {
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

/** Throws when the value was changed or encrypted with another key: tampering never decrypts. */
export function decryptField(key: FieldKey, stored: string): string {
  const [version, payload] = stored.split(":");
  if (version !== VERSION || !payload) throw new Error("Unknown encrypted field format");
  const bytes = Buffer.from(payload, "base64");
  const decipher = createDecipheriv("aes-256-gcm", key, bytes.subarray(0, IV_BYTES));
  decipher.setAuthTag(bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES));
  return Buffer.concat([decipher.update(bytes.subarray(IV_BYTES + TAG_BYTES)), decipher.final()]).toString("utf8");
}
