// OWASP A01 (access control), A03 (stored script) and A10 (input errors) for the change vouchers of M8 (brief §5.6,
// FR-CHG-001). Route-level 401s are also walked by access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { bookingSetup, createServiceViaApi } from "../support/data";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];

test.describe("A01 who raises and reads vouchers", () => {
  test("only the roles that raise contracts raise a voucher; reading follows the contract", async ({
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const raisers = new Set<Role>();
    for (const role of ROLES) {
      const response = await (
        await apiAs(role)
      ).post("/api/v1/contract-changes/renewals", {
        headers: { "Idempotency-Key": randomUUID() },
        data: { contractId: contract.id, sessions: 1 },
      });
      // Allowed (waiting for approval) or refused for the role; never a server error.
      expect([202, 201, 403, 404], `${role} ${response.status()}`).toContain(response.status());
      if (response.status() === 202 || response.status() === 201) raisers.add(role);
    }
    expect(raisers.has("FITNESS_MANAGER")).toBe(true);
    for (const role of ["PT", "ACCOUNTANT"] as Role[]) expect(raisers.has(role), role).toBe(false);

    const admin = await apiAs("ADMIN");
    const listed = (await (await admin.get(`/api/v1/contract-changes?contractId=${contract.id}`)).json()) as {
      items: { id: string }[];
      total: number;
    };
    expect(listed.total).toBe(raisers.size);
    // A role without the contract in its scope reads none of them.
    const pt = await apiAs("PT");
    expect((await pt.get(`/api/v1/contract-changes/${listed.items[0]!.id}`)).status()).toBe(404);
  });

  test("upgrades and conversions follow the same rule: only the roles that raise contracts", async ({
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const admin = await apiAs("ADMIN");
    const service = await createServiceViaApi(admin, `Nâng cấp ${testTag}`);
    for (const path of ["upgrades", "conversions"]) {
      for (const role of ROLES) {
        const response = await (
          await apiAs(role)
        ).post(`/api/v1/contract-changes/${path}`, {
          headers: { "Idempotency-Key": randomUUID() },
          data: { contractId: contract.id, targetServiceId: service.id, sessions: 5, amount: 1000, credit: 500 },
        });
        expect([202, 201, 403, 404], `${path} ${role} ${response.status()}`).toContain(response.status());
        if (role === "PT" || role === "ACCOUNTANT") expect(response.status(), `${path} ${role}`).toBe(403);
      }
    }
    const anonymous = await apiAs(null);
    for (const path of ["upgrades", "conversions"]) {
      expect(
        (
          await anonymous.post(`/api/v1/contract-changes/${path}`, {
            headers: { "Idempotency-Key": randomUUID() },
            data: {},
          })
        ).status(),
      ).toBe(401);
    }
  });

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/contract-changes")).status()).toBe(401);
    expect(
      (
        await anonymous.post("/api/v1/contract-changes/renewals", {
          headers: { "Idempotency-Key": randomUUID() },
          data: {},
        })
      ).status(),
    ).toBe(401);
    expect(
      (
        await anonymous.post("/api/v1/contract-changes/holds", {
          headers: { "Idempotency-Key": randomUUID() },
          data: {},
        })
      ).status(),
    ).toBe(401);
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a script in a note is kept as text, bad requests are 400 or 404, and a key is needed and reused safely", async ({
    apiAs,
    testTag,
  }) => {
    const { contract } = await bookingSetup(apiAs, testTag);
    const manager = await apiAs("FITNESS_MANAGER");
    const renew = (data: unknown, key: string | null = randomUUID()) =>
      manager.post("/api/v1/contract-changes/renewals", {
        headers: key ? { "Idempotency-Key": key } : {},
        data: data as never,
      });

    const script = `<script>alert(1)</script> ${testTag}`;
    const key = randomUUID();
    const stored = await renew({ contractId: contract.id, sessions: 2, note: script }, key);
    expect(stored.status()).toBe(202);
    expect(await stored.json()).toMatchObject({ note: script, status: "PENDING" });
    // The same key and content: the same voucher (200); other content with the key: refused.
    const replay = await renew({ contractId: contract.id, sessions: 2, note: script }, key);
    expect(replay.status()).toBe(200);
    expect((await renew({ contractId: contract.id, sessions: 3, note: script }, key)).status()).toBe(409);
    expect((await renew({ contractId: contract.id, sessions: 2 }, null)).status()).toBe(400);
    expect((await renew({ contractId: contract.id, sessions: 2 }, "nope")).status()).toBe(400);

    for (const data of [
      {},
      { contractId: contract.id },
      { contractId: contract.id, sessions: -1 },
      { contractId: contract.id, sessions: 1001 },
      { contractId: contract.id, months: "x" },
      { contractId: contract.id, sessions: 1, fromDate: "99/99/2026" },
      { contractId: contract.id, sessions: 1, note: "a\u0007b" },
      { contractId: contract.id, sessions: 1, note: "x".repeat(501) },
      { contractId: "nope", sessions: 1 },
    ]) {
      expect((await renew(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    expect((await renew({ contractId: randomUUID(), sessions: 1 })).status()).toBe(404);

    const hold = (data: unknown) =>
      manager.post("/api/v1/contract-changes/holds", {
        headers: { "Idempotency-Key": randomUUID() },
        data: data as never,
      });
    for (const data of [
      {},
      { contractId: contract.id },
      { contractId: contract.id, fromDate: "20/06/2031", toDate: "18/06/2031" },
      { contractId: contract.id, fromDate: "01/01/2020", toDate: "02/01/2020" },
    ]) {
      expect((await hold(data)).status(), JSON.stringify(data)).toBe(400);
    }
    const first = await hold({ contractId: contract.id, fromDate: "18/06/2031", toDate: "22/06/2031" });
    expect(first.status()).toBe(202);
    const overlap = await hold({ contractId: contract.id, fromDate: "22/06/2031", toDate: "25/06/2031" });
    expect(overlap.status()).toBe(400);
    expect(await overlap.json()).toMatchObject({ details: { fieldErrors: { fromDate: ["overlapsHold"] } } });

    // An exchange: a missing key, a credit above the price, a service that does not exist, and a script in the note.
    const service = await createServiceViaApi(await apiAs("ADMIN"), `Gói ${testTag}`);
    const exchange = (data: unknown, key: string | null = randomUUID()) =>
      manager.post("/api/v1/contract-changes/upgrades", {
        headers: key ? { "Idempotency-Key": key } : {},
        data: data as never,
      });
    const valid = { contractId: contract.id, targetServiceId: service.id, sessions: 5, amount: 1000, credit: 500 };
    expect((await exchange(valid, null)).status()).toBe(400);
    for (const patch of [
      { credit: 2000 },
      { sessions: 0 },
      { sessions: 1001 },
      { amount: -1 },
      { targetServiceId: "nope" },
      { note: "ab" },
    ]) {
      expect((await exchange({ ...valid, ...patch })).status(), JSON.stringify(patch)).toBe(400);
    }
    expect((await exchange({ ...valid, targetServiceId: randomUUID() })).status()).toBe(400);
    const exchanged = await exchange({ ...valid, note: script });
    expect(exchanged.status()).toBe(202);
    expect(await exchanged.json()).toMatchObject({ note: script, kind: "UPGRADE" });

    expect((await manager.get("/api/v1/contract-changes/not-a-uuid")).status()).toBe(404);
    for (const query of ["kind=OTHER", "status=NOPE", "pageSize=101", "page=0", "contractId=nope"]) {
      expect((await manager.get(`/api/v1/contract-changes?${query}`)).status(), query).toBe(400);
    }
  });
});
