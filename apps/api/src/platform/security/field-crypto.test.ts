import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptField, encryptField, parseFieldKey } from "./field-crypto.js";

const key = randomBytes(32);

describe("field encryption (D-042, T-052)", () => {
  it("round-trips, and never stores the plain value", () => {
    const stored = encryptField(key, "079201001234");
    expect(stored).toMatch(/^v1:[A-Za-z0-9+/=]+$/);
    expect(stored).not.toContain("079201001234");
    expect(decryptField(key, stored)).toBe("079201001234");
  });

  it("uses a fresh IV, so the same value never looks the same twice", () => {
    expect(encryptField(key, "Đau lưng")).not.toBe(encryptField(key, "Đau lưng"));
  });

  it("refuses a changed value, another key, or an unknown format", () => {
    const stored = encryptField(key, "B1234567");
    const bytes = Buffer.from(stored.slice(3), "base64");
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptField(key, `v1:${bytes.toString("base64")}`)).toThrow();
    expect(() => decryptField(randomBytes(32), stored)).toThrow();
    expect(() => decryptField(key, "079201001234")).toThrow("Unknown encrypted field format");
  });

  it("takes only a 32-byte key", () => {
    expect(parseFieldKey(key.toString("base64"))).toEqual(key);
    expect(() => parseFieldKey(randomBytes(16).toString("base64"))).toThrow("32 bytes");
  });
});
