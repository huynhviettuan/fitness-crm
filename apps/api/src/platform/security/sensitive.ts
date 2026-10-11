import { env } from "../env.js";
import { decryptField, encryptField, parseFieldKey } from "./field-crypto.js";

// The environment's key applied to the sensitive fields (D-042, T-052): seal before a
// write, unseal only to show a user who may see the field.

const key = parseFieldKey(env.FIELD_ENCRYPTION_KEY);

export function seal(value: string | null): string | null {
  return value === null ? null : encryptField(key, value);
}

export function unseal(value: string | null): string | null {
  return value === null ? null : decryptField(key, value);
}
