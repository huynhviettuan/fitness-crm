// OWASP A01 (access control), A03 (stored script and links in a catalog) and A10 (input errors) for the workout catalogs
// of M7.1 (brief §7.1, FR-WKO-001). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const SEE: Role[] = ["ADMIN", "FITNESS_MANAGER", "PT"];
const KEEP: Role[] = ["ADMIN", "FITNESS_MANAGER"];
const LISTS = ["equipment", "areas", "exercises", "stages"];

test.describe("A01 who sees and keeps the catalogs", () => {
  for (const role of ROLES) {
    test(`${role} reading the catalogs gets ${SEE.includes(role) ? 200 : 403}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      for (const list of LISTS) {
        expect((await api.get(`/api/v1/workout/${list}`)).status(), list).toBe(SEE.includes(role) ? 200 : 403);
      }
    });

    test(`${role} adding to the catalogs gets ${KEEP.includes(role) ? 201 : 403}`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const status = KEEP.includes(role) ? 201 : 403;
      const code = `S${role.slice(0, 2)}${testTag}`.slice(0, 20);
      const equipment = await api.post("/api/v1/workout/equipment", { data: { code, name: `Máy ${role} ${testTag}` } });
      expect(equipment.status()).toBe(status);
      expect((await api.post("/api/v1/workout/stages", { data: { name: `Stage ${role} ${testTag}` } })).status()).toBe(
        status,
      );
      expect(
        (await api.post("/api/v1/workout/areas", { data: { code, name: `Vùng ${role} ${testTag}` } })).status(),
      ).toBe(status);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    for (const list of LISTS) expect((await anonymous.get(`/api/v1/workout/${list}`)).status(), list).toBe(401);
    expect((await anonymous.post("/api/v1/workout/stages", { data: { name: "x" } })).status()).toBe(401);
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a script in a name is kept as text, a video must be https, and a bad request is a 400", async ({
    apiAs,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const area = (await (
      await admin.post("/api/v1/workout/areas", { data: { code: `Z${testTag}`.slice(0, 20), name: `Vùng ${testTag}` } })
    ).json()) as { id: string };
    const script = `<script>alert(1)</script> ${testTag}`;
    const stored = await admin.post("/api/v1/workout/stages", { data: { name: script } });
    expect(stored.status()).toBe(201);
    expect(await stored.json()).toMatchObject({ name: script });

    const base = { name: `Bài ${testTag}`, areaId: area.id, kind: "STRENGTH" };
    for (const data of [
      {},
      { ...base, videoUrl: "http://video.example.test/x" },
      { ...base, videoUrl: "javascript:alert(1)" },
      { ...base, kind: "YOGA" },
      { ...base, areaId: "nope" },
      { ...base, areaId: randomUUID() },
      { ...base, equipmentId: randomUUID() },
      { ...base, name: "a\u0007b" },
      { ...base, name: "x".repeat(151) },
    ]) {
      const response = await admin.post("/api/v1/workout/exercises", { data });
      expect(response.status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    expect((await admin.post("/api/v1/workout/equipment", { data: { code: "bad code!", name: "x" } })).status()).toBe(
      400,
    );
    const missing = await admin.patch(`/api/v1/workout/areas/${randomUUID()}`, { data: { code: "A", name: "A" } });
    expect(missing.status()).toBe(404);
    expect((await admin.get("/api/v1/workout/exercises/not-a-uuid")).status()).toBe(404);
    for (const query of ["kind=YOGA", "pageSize=101", "page=0", "areaId=nope"]) {
      expect((await admin.get(`/api/v1/workout/exercises?${query}`)).status(), query).toBe(400);
    }
  });

  test("the area tree cannot loop through the API", async ({ apiAs, testTag }) => {
    const admin = await apiAs("ADMIN");
    const make = async (code: string, parentId: string | null = null) => {
      const response = await admin.post("/api/v1/workout/areas", {
        data: { code: `${code}${testTag}`.slice(0, 20), name: `${code} ${testTag}`, parentId },
      });
      return (await response.json()) as { id: string };
    };
    const top = await make("T");
    const mid = await make("M", top.id);

    const loop = await admin.patch(`/api/v1/workout/areas/${top.id}`, {
      data: { code: `T${testTag}`.slice(0, 20), name: `T ${testTag}`, parentId: mid.id },
    });
    expect(loop.status()).toBe(400);
    expect(await loop.json()).toMatchObject({ details: { fieldErrors: { parentId: ["cycle"] } } });
  });
});
