// OWASP A01 (access control, another person's data), A04 (business rules) and A10 (input errors) for the staff
// notifications of M6.4 (D-053, D-056): the employee's own choices, Admin's mandatory marks, and the devices a push can
// reach.
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const KEYS = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u", auth: "tBHItJI5svbpez7KI4CCXg" };

test.describe("A01 whose choices and which marks", () => {
  for (const role of ROLES) {
    test(`${role} reads and saves their own choices, the key, and their own devices`, async ({ apiAs, testTag }) => {
      const api = await apiAs(role);
      const endpoint = `https://push.example.test/send/${testTag}-${role}`;

      expect((await api.get("/api/v1/notification-preferences")).status()).toBe(200);
      expect((await api.get("/api/v1/push/key")).status()).toBe(200);
      const saved = await api.put("/api/v1/notification-preferences", {
        data: { items: [{ kind: "taskDueSoon", email: true, push: true }] },
      });
      expect(saved.status()).toBe(200);
      expect((await api.put("/api/v1/push/subscription", { data: { endpoint, keys: KEYS } })).status()).toBe(204);
      expect((await api.post("/api/v1/push/unsubscribe", { data: { endpoint } })).status()).toBe(204);
    });

    test(`${role} reading and saving the mandatory marks gets ${role === "ADMIN" ? 200 : 403}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const status = role === "ADMIN" ? 200 : 403;
      const read = await api.get("/api/v1/notification-settings");
      expect(read.status()).toBe(status);
      if (role === "ADMIN") {
        // Saving what is there changes nothing.
        const current = await read.json();
        expect((await api.put("/api/v1/notification-settings", { data: current })).status()).toBe(200);
      } else {
        expect((await api.put("/api/v1/notification-settings", { data: { items: [] } })).status()).toBe(403);
      }
    });
  }

  test("an anonymous request gets 401 everywhere", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    for (const path of ["notification-preferences", "notification-settings", "push/key"]) {
      expect((await anonymous.get(`/api/v1/${path}`)).status(), path).toBe(401);
    }
    expect((await anonymous.put("/api/v1/push/subscription", { data: {} })).status()).toBe(401);
    expect((await anonymous.post("/api/v1/push/unsubscribe", { data: {} })).status()).toBe(401);
  });

  test("one employee cannot remove another's device", async ({ apiAs, testTag }) => {
    const owner = await apiAs("RECEPTIONIST");
    const other = await apiAs("PT");
    const endpoint = `https://push.example.test/send/${testTag}-owner`;
    await owner.put("/api/v1/push/subscription", { data: { endpoint, keys: KEYS } });

    await other.post("/api/v1/push/unsubscribe", { data: { endpoint } });
    const preferences = (await (await owner.get("/api/v1/notification-preferences")).json()) as { pushDevices: number };
    expect(preferences.pushDevices).toBeGreaterThanOrEqual(1);

    await owner.post("/api/v1/push/unsubscribe", { data: { endpoint } });
  });
});

test.describe("A10 the inputs", () => {
  test("bad choices, marks and devices are a 400, never a 500", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");
    const bad = (data: Record<string, unknown>) => admin.put("/api/v1/notification-preferences", { data });

    for (const data of [
      {},
      { items: [{ kind: "taskCommented", email: true, push: true }] },
      { items: [{ kind: "taskOverdue", email: "yes", push: true }] },
      {
        items: [
          { kind: "taskOverdue", email: true, push: true },
          { kind: "taskOverdue", email: false, push: true },
        ],
      },
    ]) {
      expect((await bad(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    for (const data of [
      {},
      { items: [{ kind: "nope", emailMandatory: true, pushMandatory: false }] },
      { items: [{ kind: "taskOverdue", emailMandatory: 1, pushMandatory: false }] },
    ]) {
      expect((await admin.put("/api/v1/notification-settings", { data })).status()).toBe(400);
    }
    for (const data of [
      {},
      { endpoint: "http://push.example.test/x", keys: KEYS },
      { endpoint: "javascript:alert(1)", keys: KEYS },
      { endpoint: `https://push.example.test/${"x".repeat(2100)}`, keys: KEYS },
      { endpoint: "https://push.example.test/x", keys: { p256dh: "", auth: "" } },
    ]) {
      expect((await admin.put("/api/v1/push/subscription", { data })).status(), JSON.stringify(data).slice(0, 60)).toBe(
        400,
      );
    }
    expect((await admin.post("/api/v1/push/unsubscribe", { data: { endpoint: "ftp://x" } })).status()).toBe(400);
  });
});
