// OWASP A01 (access control, data scope, masking, mass assignment) and A10 (input errors) for
// M3 slice 2: the automatic consulting audit (brief §4.1; FR-LEAD-011; A-081 to A-085). Route-level
// 401s and 403s for every operation are also walked by permissions.spec.ts and access-control.spec.ts.
// The global criteria are changed in lead-audit-criteria.branch.spec.ts; here they are only read, and
// a write is tried with the values they already have.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { createUserViaApi } from "../support/admin";
import { createLeadViaApi } from "../support/data";
import type { Role } from "../support/db";
import { setFirstStep } from "../support/db";
import { createOptionViaApi, otherOptionId } from "../support/options";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const MANAGERS: Role[] = ["ADMIN", "FITNESS_MANAGER"];
const SCOPES_ALL = {
  leads: "ALL",
  customers: "ALL",
  contracts: "ALL",
  schedule: "ALL",
  vouchers: "ALL",
  staff: "ALL",
  tasks: "ALL",
};

test.describe("A01 who sees the audit (A-084)", () => {
  for (const path of ["consultants", "leads", "criteria"]) {
    for (const role of ROLES) {
      const status = MANAGERS.includes(role) ? 200 : 403;
      test(`${role} reading /lead-audit/${path} gets ${status} (lead.audit)`, async ({ apiAs }) => {
        const response = await (await apiAs(role)).get(`/api/v1/lead-audit/${path}`);

        expect(response.status()).toBe(status);
        if (status === 403) expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
      });
    }
  }

  for (const role of ROLES) {
    const status = MANAGERS.includes(role) ? 200 : 403;
    test(`${role} reading one lead's audit gets ${status}`, async ({ apiAs, testTag }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Audit ${role} ${testTag}` });

      const response = await (await apiAs(role)).get(`/api/v1/lead-audit/leads/${lead.id}`);

      expect(response.status()).toBe(status);
    });
  }

  test("an anonymous request gets 401 on every audit route", async ({ apiAs }) => {
    const anonymous = await apiAs(null);

    for (const path of ["consultants", "leads", "criteria", `leads/${randomUUID()}`]) {
      expect((await anonymous.get(`/api/v1/lead-audit/${path}`)).status(), path).toBe(401);
    }
    expect((await anonymous.put("/api/v1/lead-audit/criteria", { data: {} })).status()).toBe(401);
  });

  test("changing the criteria needs config.manage: a consultant, a receptionist, and an auditor of leads are refused", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const current = (await (await admin.get("/api/v1/lead-audit/criteria")).json()) as {
      items: { key: string; active: boolean; weight: number }[];
    };
    const auditorRole = await admin.post("/api/v1/roles", {
      data: {
        name: `Kiểm tra ${testTag}`,
        permissions: ["lead.view", "lead.audit"],
        dataScopes: SCOPES_ALL,
        fieldMasks: [],
      },
    });
    const auditor = await createUserViaApi(admin, testTag, { roleId: (await auditorRole.json()).id, label: "Custom" });

    for (const api of [
      await apiAs("CONSULTING"),
      await apiAs("RECEPTIONIST"),
      await apiSignedIn(auditor.email, auditor.password),
    ]) {
      expect((await api.put("/api/v1/lead-audit/criteria", { data: { criteria: current.items } })).status()).toBe(403);
    }
    // Admin writing the values it already has changes nothing.
    const same = await admin.put("/api/v1/lead-audit/criteria", { data: { criteria: current.items } });
    expect(same.status()).toBe(200);
    expect(await same.json()).toEqual(current);
  });
});

test.describe("A01 masks and mass assignment", () => {
  test("a user who cannot see phones gets no phone criterion in a lead's audit", async ({
    apiAs,
    apiSignedIn,
    testTag,
  }) => {
    const admin = await apiAs("ADMIN");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Che số ${testTag}` });
    const created = await admin.post("/api/v1/roles", {
      data: {
        name: `Che số ${testTag}`,
        permissions: ["lead.view", "lead.audit"],
        dataScopes: SCOPES_ALL,
        fieldMasks: ["customer.phone"],
      },
    });
    const user = await createUserViaApi(admin, testTag, { roleId: (await created.json()).id, label: "Custom" });
    const masked = await apiSignedIn(user.email, user.password);

    const hidden = (await (await masked.get(`/api/v1/lead-audit/leads/${lead.id}`)).json()) as {
      criteria: { key: string }[];
    };
    const full = (await (await admin.get(`/api/v1/lead-audit/leads/${lead.id}`)).json()) as {
      criteria: { key: string }[];
    };

    expect(full.criteria.map((criterion) => criterion.key)).toContain("phone");
    expect(hidden.criteria.map((criterion) => criterion.key)).not.toContain("phone");
  });

  test("the criteria body takes only a switch and a weight per known key: an id or a name is ignored", async ({
    apiAs,
  }) => {
    const admin = await apiAs("ADMIN");
    const current = (await (await admin.get("/api/v1/lead-audit/criteria")).json()) as {
      items: { key: string; active: boolean; weight: number }[];
    };

    const response = await admin.put("/api/v1/lead-audit/criteria", {
      data: { criteria: current.items.map((item) => ({ ...item, id: randomUUID(), label: "x" })), extra: true },
    });

    expect(response.status()).toBe(200);
    expect(await response.json()).toEqual(current);
  });

  test("the audit shows a lead only to those who may see it: an unknown or bad id is 404", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    expect((await manager.get(`/api/v1/lead-audit/leads/${randomUUID()}`)).status()).toBe(404);
    expect((await manager.get("/api/v1/lead-audit/leads/not-a-uuid")).status()).toBe(404);
  });
});

test.describe("A10 audit input errors", () => {
  test("bad filters are 400 with field errors", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const bad = async (path: string, field: string) => {
      const response = await manager.get(`/api/v1/lead-audit/${path}`);
      expect(response.status(), path).toBe(400);
      expect((await response.json()).details.fieldErrors, path).toHaveProperty(field);
    };

    await bad("consultants?from=31/02/2026", "from");
    await bad("leads?consultantId=x", "consultantId");
    await bad("leads?to=nope", "to");
  });

  test("the page and its size are bounded: nonsense is 400, not an error", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    for (const query of ["page=0", "page=-1", "pageSize=0", "pageSize=101", "page=abc"]) {
      expect((await manager.get(`/api/v1/lead-audit/leads?${query}`)).status(), query).toBe(400);
    }
    expect((await manager.get("/api/v1/lead-audit/leads?page=999&pageSize=100")).status()).toBe(200);
  });

  test("a criteria body with a weight outside 1 to 10, a missing, repeated, or unknown key, or no body is 400", async ({
    apiAs,
  }) => {
    const admin = await apiAs("ADMIN");
    const base = [
      { key: "needGroup", active: true, weight: 1 },
      { key: "phone", active: true, weight: 1 },
      { key: "refuseReason", active: true, weight: 1 },
    ];
    const put = (criteria: unknown) => admin.put("/api/v1/lead-audit/criteria", { data: { criteria } });

    for (const criteria of [
      [{ ...base[0], weight: 0 }, base[1], base[2]],
      [{ ...base[0], weight: 11 }, base[1], base[2]],
      [{ ...base[0], weight: 1.5 }, base[1], base[2]],
      [{ ...base[0], active: "yes" }, base[1], base[2]],
      [base[0], base[1]],
      [base[0], base[0], base[1]],
      [{ key: "colour", active: true, weight: 1 }, base[1], base[2]],
      "criteria",
    ]) {
      const response = await put(criteria);
      expect(response.status(), JSON.stringify(criteria)).toBe(400);
      expect(await response.json()).toMatchObject({ code: "VALIDATION_FAILED" });
    }
    expect((await admin.put("/api/v1/lead-audit/criteria", { data: {} })).status()).toBe(400);
  });

  test("a lead whose step is late is reported late, never as an error", async ({ apiAs, testTag }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Trễ ${testTag}` });
    await setFirstStep(lead.id, "late");

    const audit = (await (
      await (await apiAs("FITNESS_MANAGER")).get(`/api/v1/lead-audit/leads/${lead.id}`)
    ).json()) as {
      late: number;
      compliance: number;
    };

    expect(audit).toMatchObject({ late: 1, compliance: 0 });
  });
});

test.describe("the manager audit (A-086 to A-088)", () => {
  for (const role of ROLES) {
    const status = MANAGERS.includes(role) ? 201 : 403;
    test(`${role} grading a lead gets ${status} (lead.audit)`, async ({ apiAs, testTag }) => {
      const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Chấm ${role} ${testTag}` });

      const response = await (await apiAs(role)).post(`/api/v1/leads/${lead.id}/audits`, { data: { result: "PASS" } });

      expect(response.status()).toBe(status);
      if (status === 403) {
        const audits = (await (await (await apiAs("ADMIN")).get(`/api/v1/leads/${lead.id}/audits`)).json()) as {
          items: unknown[];
        };
        expect(audits.items).toHaveLength(0);
      }
    });
  }

  for (const role of ROLES) {
    const status = MANAGERS.includes(role) ? 200 : 403;
    test(`${role} reading /lead-audit/queue gets ${status}`, async ({ apiAs }) => {
      expect((await (await apiAs(role)).get("/api/v1/lead-audit/queue")).status()).toBe(status);
    });
  }

  test("whoever can see the lead sees its grades: a consultant and a receptionist do, an accountant does not", async ({
    apiAs,
    testTag,
  }) => {
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Xem ${testTag}` });
    await (await apiAs("FITNESS_MANAGER")).post(`/api/v1/leads/${lead.id}/audits`, { data: { result: "PASS" } });

    for (const role of ["CONSULTING", "RECEPTIONIST", "FITNESS_MANAGER"] as const) {
      const response = await (await apiAs(role)).get(`/api/v1/leads/${lead.id}/audits`);
      expect(response.status(), role).toBe(200);
      expect(((await response.json()) as { items: unknown[] }).items).toHaveLength(1);
    }
    expect((await (await apiAs("ACCOUNTANT")).get(`/api/v1/leads/${lead.id}/audits`)).status()).toBe(403);
    expect((await (await apiAs(null)).get(`/api/v1/leads/${lead.id}/audits`)).status()).toBe(401);
  });

  test("the auditor, the time, and the lead are the server's, and a grade cannot be changed or removed", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    const manager = await apiAs("FITNESS_MANAGER");
    const lead = await createLeadViaApi(reception, { fullName: `Của tôi ${testTag}` });
    const other = await createLeadViaApi(reception, { fullName: `Của người khác ${testTag}` });
    const managerId = ((await (await manager.get("/api/v1/me")).json()) as { id: string }).id;

    const response = await manager.post(`/api/v1/leads/${lead.id}/audits`, {
      data: {
        result: "PASS",
        auditorId: randomUUID(),
        auditor: { id: randomUUID() },
        personId: other.id,
        at: "2001-01-01",
      },
    });

    expect(response.status()).toBe(201);
    const audit = (await response.json()) as { id: string; auditor: { id: string }; at: string };
    expect(audit.auditor.id).toBe(managerId);
    expect(new Date(audit.at).getFullYear()).toBeGreaterThan(2020);
    const countFor = async (id: string) =>
      ((await (await manager.get(`/api/v1/leads/${id}/audits`)).json()) as { items: unknown[] }).items.length;
    expect(await countFor(lead.id)).toBe(1);
    expect(await countFor(other.id)).toBe(0);
    for (const method of ["patch", "put", "delete"] as const) {
      const attempt = await manager[method](`/api/v1/leads/${lead.id}/audits/${audit.id}`, {
        data: { result: "FAIL" },
      });
      expect([404, 405], method).toContain(attempt.status());
    }
  });

  test("a Fail needs criteria of its own list, a Pass none, and Khác needs the comment", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const admin = await apiAs("ADMIN");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Quy tắc ${testTag}` });
    const criterion = await createOptionViaApi(admin, "auditFailReasons", `Tiêu chí ${testTag}`);
    const other = await otherOptionId(admin, "auditFailReasons");
    const channels = (await (await admin.get("/api/v1/option-lists/leadChannels/options")).json()) as {
      items: { id: string }[];
    };
    const post = (data: unknown) => manager.post(`/api/v1/leads/${lead.id}/audits`, { data });
    const errors = async (data: unknown) => {
      const response = await post(data);
      expect(response.status(), JSON.stringify(data)).toBe(400);
      return (await response.json()).details.fieldErrors;
    };

    expect(await errors({ result: "FAIL" })).toMatchObject({ criterionIds: ["required"] });
    expect(await errors({ result: "PASS", criterionIds: [criterion] })).toMatchObject({
      criterionIds: ["noCriteriaOnPass"],
    });
    expect(await errors({ result: "FAIL", criterionIds: [criterion, criterion] })).toHaveProperty("criterionIds");
    expect(await errors({ result: "FAIL", criterionIds: [channels.items[0].id] })).toMatchObject({
      criterionIds: ["invalidChoice"],
    });
    expect(await errors({ result: "FAIL", criterionIds: [randomUUID()] })).toMatchObject({
      criterionIds: ["invalidChoice"],
    });
    expect(await errors({ result: "FAIL", criterionIds: [other] })).toMatchObject({ comment: ["otherNeedsNote"] });
    expect(await errors({ result: "PASS", comment: "a\u0000b" })).toMatchObject({ comment: ["invalidCharacters"] });
    expect(await errors({ result: "PASS", comment: "x".repeat(2001) })).toMatchObject({ comment: ["tooLong"] });
    expect(await errors({ result: "MAYBE" })).toMatchObject({ result: ["invalidChoice"] });
    expect(await errors({})).toHaveProperty("result");
    expect((await post({ result: "FAIL", criterionIds: [other], comment: "Lý do khác" })).status()).toBe(201);
  });

  test("an unknown or bad lead id is 404, and a comment is returned as plain text", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const lead = await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Chữ ${testTag}` });
    const payload = `<script>alert("${testTag}")</script>`;

    expect((await manager.post(`/api/v1/leads/${randomUUID()}/audits`, { data: { result: "PASS" } })).status()).toBe(
      404,
    );
    expect((await manager.post("/api/v1/leads/not-a-uuid/audits", { data: { result: "PASS" } })).status()).toBe(404);
    const response = await manager.post(`/api/v1/leads/${lead.id}/audits`, {
      data: { result: "PASS", comment: payload },
    });
    expect(response.status()).toBe(201);
    expect(response.headers()["content-type"]).toContain("application/json");
    expect(await response.json()).toMatchObject({ comment: payload });
  });

  test("the queue holds only people nobody has graded: a graded lead is not in it", async ({ apiAs, testTag }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const reception = await apiAs("RECEPTIONIST");
    const graded = await createLeadViaApi(reception, { fullName: `Đã chấm ${testTag}` });
    const waiting = await createLeadViaApi(reception, { fullName: `Chưa chấm ${testTag}` });
    await manager.post(`/api/v1/leads/${graded.id}/audits`, { data: { result: "PASS" } });
    const ids = async () => {
      const found: string[] = [];
      for (let page = 1; page <= 20; page++) {
        const body = (await (await manager.get(`/api/v1/lead-audit/queue?pageSize=100&page=${page}`)).json()) as {
          items: { id: string }[];
        };
        found.push(...body.items.map((item) => item.id));
        if (body.items.length < 100) break;
      }
      return found;
    };

    const queue = await ids();

    expect(queue).toContain(waiting.id);
    expect(queue).not.toContain(graded.id);
  });

  test("bad queue filters are 400", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    expect((await manager.get("/api/v1/lead-audit/queue?consultantId=x")).status()).toBe(400);
    expect((await manager.get("/api/v1/lead-audit/queue?from=31/02/2026")).status()).toBe(400);
    expect((await manager.get("/api/v1/lead-audit/queue?pageSize=0")).status()).toBe(400);
  });
});
