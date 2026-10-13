// OWASP A01 (access control), A03/A04 (what may be uploaded), A05 (headers) and A10 (input errors) for the private
// pictures of M4.1b (T-052, A-143, A-144).
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64",
);
const upload = (api: APIRequestContext, purpose: string, body: Buffer, type = "image/png") =>
  api.post(`/api/v1/files?purpose=${purpose}`, { data: body, headers: { "content-type": type } });

test.describe("A01 who uploads and who sees a picture", () => {
  const uploads: [Role, string, number][] = [
    ["ADMIN", "service_image", 201],
    ["FITNESS_MANAGER", "service_image", 403],
    ["RECEPTIONIST", "service_image", 403],
    ["RECEPTIONIST", "receipt_proof", 201],
    ["PT", "receipt_proof", 403],
  ];
  for (const [role, purpose, status] of uploads) {
    test(`${role} uploading a ${purpose} gets ${status}`, async ({ apiAs }) => {
      const response = await upload(await apiAs(role), purpose, PNG);
      expect(response.status(), await response.text()).toBe(status);
    });
  }

  test("an anonymous upload or link gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await upload(anonymous, "service_image", PNG)).status()).toBe(401);
    expect((await anonymous.get("/api/v1/files/00000000-0000-4000-8000-000000000001/link")).status()).toBe(401);
  });

  test("an unattached picture is its uploader's alone, and a link works for nobody else", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    const file = (await (await upload(admin, "service_image", PNG)).json()) as { id: string };

    const link = (await (await admin.get(`/api/v1/files/${file.id}/link`)).json()) as { url: string };
    const mine = await admin.get(link.url);
    expect(mine.status()).toBe(200);
    expect(mine.headers()["content-type"]).toBe("image/png");
    expect(mine.headers()["cache-control"]).toBe("private, no-store");
    expect(mine.headers()["x-content-type-options"]).toBe("nosniff");
    expect(Buffer.compare(await mine.body(), PNG)).toBe(0);

    expect((await (await apiAs("FITNESS_MANAGER")).get(`/api/v1/files/${file.id}/link`)).status()).toBe(404);
    // A link made for the admin does not open for another user, signed in or not.
    expect((await (await apiAs("FITNESS_MANAGER")).get(link.url)).status()).toBe(403);
    expect((await (await apiAs(null)).get(link.url)).status()).toBe(401);
    expect((await admin.get(link.url.replace(/signature=[0-9a-f]{4}/, "signature=0000"))).status()).toBe(403);
    expect((await admin.get(`/api/v1/files/${file.id}/content`)).status()).toBe(403);
  });
});

test.describe("A03 and A10 what may be uploaded", () => {
  test("only real PNG, JPEG, or WebP pictures, whatever the name or type says", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>');
    const html = Buffer.from("<html><script>alert(1)</script></html>");

    for (const [body, type] of [
      [svg, "image/png"],
      [html, "image/jpeg"],
      [svg, "image/svg+xml"],
    ] as const) {
      const response = await upload(admin, "service_image", body, type);
      expect([400, 404, 415], type).toContain(response.status());
      expect(response.status()).not.toBe(201);
    }
  });

  test("an unknown purpose and an oversize picture are 400 or 413, never stored", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");

    expect((await upload(admin, "passport", PNG)).status()).toBe(400);
    const big = Buffer.concat([PNG, Buffer.alloc(6 * 1024 * 1024)]);
    const response = await upload(admin, "service_image", big);
    expect([400, 413], await response.text()).toContain(response.status());
  });

  test("a picture is attached only by the person who uploaded it, and once", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const file = (await (await upload(admin, "service_image", PNG)).json()) as { id: string };
    const { items } = (await (await admin.get("/api/v1/branches")).json()) as {
      items: { id: string; active: boolean }[];
    };
    const branchIds = [items.find((branch) => branch.active)!.id];
    const one = (await (
      await admin.post("/api/v1/services", { data: { name: `Một ${testTag}`, kind: "MEMBER", branchIds } })
    ).json()) as {
      id: string;
    };
    const two = (await (
      await admin.post("/api/v1/services", { data: { name: `Hai ${testTag}`, kind: "MEMBER", branchIds } })
    ).json()) as {
      id: string;
    };

    expect((await admin.put(`/api/v1/services/${one.id}/image`, { data: { fileId: file.id } })).status()).toBe(200);
    const again = await admin.put(`/api/v1/services/${two.id}/image`, { data: { fileId: file.id } });
    expect(again.status()).toBe(400);
    expect(await again.json()).toMatchObject({ details: { fieldErrors: { fileId: ["fileInUse"] } } });
    expect((await admin.put(`/api/v1/services/${two.id}/image`, { data: { fileId: "nope" } })).status()).toBe(400);
    expect(
      (
        await (await apiAs("FITNESS_MANAGER")).put(`/api/v1/services/${one.id}/image`, { data: { fileId: null } })
      ).status(),
    ).toBe(403);
  });
});
