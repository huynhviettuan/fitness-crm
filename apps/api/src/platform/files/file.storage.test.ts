import { describe, expect, it } from "vitest";
import { signedRequest } from "./file.storage.js";

const input = {
  method: "PUT" as const,
  host: "acct.r2.cloudflarestorage.com",
  path: "/bucket/service_image/a.png",
  body: Buffer.from("hello"),
  contentType: "image/png",
  region: "auto",
  accessKeyId: "AKID",
  secretAccessKey: "secret",
  now: new Date("2026-10-15T08:30:00.123Z"),
};

describe("signedRequest (AWS Signature V4 for R2)", () => {
  it("signs the date, the payload hash, and the headers, scoped to the day and region", () => {
    const headers = signedRequest(input);

    expect(headers["x-amz-date"]).toBe("20261015T083000Z");
    expect(headers["x-amz-content-sha256"]).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKID\/20261015\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("is repeatable, and changes with the body, the key, and the secret", () => {
    const signature = (overrides: Partial<typeof input>) =>
      signedRequest({ ...input, ...overrides }).authorization!.split("Signature=")[1];

    expect(signature({})).toBe(signature({}));
    expect(signature({ body: Buffer.from("other") })).not.toBe(signature({}));
    expect(signature({ path: "/bucket/other.png" })).not.toBe(signature({}));
    expect(signature({ secretAccessKey: "different" })).not.toBe(signature({}));
  });
});
