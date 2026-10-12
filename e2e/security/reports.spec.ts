// OWASP A01 (access control, data scope, personal data) and A10 (input errors) for M3 slice 4:
// the consulting dashboard and the lead analysis with their Excel exports (brief §9, D-041;
// A-089 to A-094). Route-level 401s and 403s for every operation are also walked by
// permissions.spec.ts and access-control.spec.ts.
import type { APIRequestContext } from "@playwright/test";
import { expect, test } from "../fixtures";
import { createUserViaApi, roleIdOf } from "../support/admin";
import { createLeadViaApi, uniquePhone } from "../support/data";
import type { Role } from "../support/db";
import { otherOptionId } from "../support/options";
import { readBody } from "../support/xlsx";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** Who holds each report permission by default (A-093); Marketing is signed in separately. */
const REPORTS: { path: string; allowed: Role[]; marketing: boolean }[] = [
  { path: "reports/consulting", allowed: ["ADMIN", "FITNESS_MANAGER", "CONSULTING"], marketing: false },
  { path: "reports/consulting/export", allowed: ["ADMIN", "FITNESS_MANAGER"], marketing: false },
  { path: "reports/lead-analysis", allowed: ["ADMIN", "FITNESS_MANAGER"], marketing: true },
  { path: "reports/lead-analysis/export", allowed: ["ADMIN", "FITNESS_MANAGER"], marketing: true },
];

async function marketing(
  apiAs: (role: Role | null) => Promise<APIRequestContext>,
  apiSignedIn: (email: string, password: string) => Promise<APIRequestContext>,
  tag: string,
) {
  const admin = await apiAs("ADMIN");
  const user = await createUserViaApi(admin, tag, {
    roleId: await roleIdOf(admin, { name: "Marketing" }),
    label: "Marketing",
  });
  return apiSignedIn(user.email, user.password);
}

test.describe("A01 who sees which report (A-093)", () => {
  for (const { path, allowed } of REPORTS) {
    for (const role of ROLES) {
      const status = allowed.includes(role) ? 200 : 403;
      test(`${role} reading /${path} gets ${status}`, async ({ apiAs }) => {
        const response = await (await apiAs(role)).get(`/api/v1/${path}`);

        expect(response.status()).toBe(status);
        if (status === 403) {
          expect(response.headers()["content-type"]).toContain("application/json");
          expect(await response.json()).toMatchObject({ code: "FORBIDDEN" });
        }
      });
    }

    test(`an anonymous request for /${path} gets 401`, async ({ apiAs }) => {
      expect((await (await apiAs(null)).get(`/api/v1/${path}`)).status()).toBe(401);
    });
  }

  for (const { path, marketing: sees } of REPORTS) {
    test(`Marketing reading /${path} gets ${sees ? 200 : 403}`, async ({ apiAs, apiSignedIn, testTag }) => {
      const api = await marketing(apiAs, apiSignedIn, testTag);

      expect((await api.get(`/api/v1/${path}`)).status()).toBe(sees ? 200 : 403);
    });
  }

  test("an export is an Excel file, and the answer to a refusal is JSON", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    for (const path of ["reports/consulting/export", "reports/lead-analysis/export"]) {
      const response = await manager.get(`/api/v1/${path}`);
      expect(response.headers()["content-type"], path).toBe(XLSX);
      expect(response.headers()["content-disposition"], path).toMatch(/^attachment; filename="[a-z-]+-\d{8}\.xlsx"$/);
      expect(response.headers()["cache-control"]).toBe("no-store");
    }
  });
});

test.describe("A01 scope and personal data", () => {
  test("a consultant's dashboard holds only their own leads, a manager's holds the team's", async ({
    apiAs,
    testTag,
  }) => {
    const reception = await apiAs("RECEPTIONIST");
    await createLeadViaApi(reception, { fullName: `Một ${testTag}`, phone: uniquePhone() });
    await createLeadViaApi(reception, { fullName: `Hai ${testTag}`, phone: uniquePhone() });
    const consultantId = ((await (await (await apiAs("CONSULTING")).get("/api/v1/me")).json()) as { id: string }).id;
    type Report = { items: { consultant: { id: string } | null; leads: number }[]; team: { leads: number } };

    const own = (await (await (await apiAs("CONSULTING")).get("/api/v1/reports/consulting")).json()) as Report;
    const team = (await (await (await apiAs("FITNESS_MANAGER")).get("/api/v1/reports/consulting")).json()) as Report;

    expect(own.items.every((row) => row.consultant?.id === consultantId)).toBe(true);
    expect(own.team.leads).toBeLessThanOrEqual(team.team.leads);
    expect(own.team.leads).toBe(own.items.reduce((sum, row) => sum + row.leads, 0));
  });

  test("the reports and their files hold counts and rates, never a name, phone, or email", async ({
    apiAs,
    testTag,
  }) => {
    const phone = uniquePhone();
    await createLeadViaApi(await apiAs("RECEPTIONIST"), { fullName: `Kín ${testTag}`, phone });
    const manager = await apiAs("FITNESS_MANAGER");

    for (const path of ["reports/consulting", "reports/lead-analysis"]) {
      const text = JSON.stringify(await (await manager.get(`/api/v1/${path}`)).json());
      expect(text, path).not.toContain(phone.slice(1));
      expect(text, path).not.toContain(testTag);
      expect(text, path).not.toMatch(/"(phone|email|fullName|leadCode)"/);
    }
    for (const path of ["reports/consulting/export", "reports/lead-analysis/export"]) {
      const file = await readBody(await (await manager.get(`/api/v1/${path}`)).body());
      expect(JSON.stringify(file), path).not.toContain(phone.slice(1));
      expect(JSON.stringify(file), path).not.toContain(testTag);
    }
  });

  test("the notes of Khác come back as plain text", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const note = `<script>alert("${testTag}")</script>`;
    const created = await reception.post("/api/v1/leads", {
      data: {
        fullName: `Ghi chú ${testTag}`,
        phone: uniquePhone(),
        channelId: await otherOptionId(reception, "leadChannels"),
        channelNote: note,
      },
    });
    expect(created.status()).toBe(201);

    const response = await (await apiAs("FITNESS_MANAGER")).get("/api/v1/reports/lead-analysis");

    expect(response.headers()["content-type"]).toContain("application/json");
    const analysis = (await response.json()) as {
      dimensions: { dimension: string; buckets: { notes: { note: string }[] }[] }[];
    };
    const channel = analysis.dimensions.find((entry) => entry.dimension === "channel")!;
    expect(channel.buckets.flatMap((bucket) => bucket.notes.map((entry) => entry.note))).toContain(note);
  });
});

test.describe("A10 report input errors", () => {
  test("bad days, branches, and people are 400 with field errors, on the reports and on their exports", async ({
    apiAs,
  }) => {
    const manager = await apiAs("FITNESS_MANAGER");
    const bad = async (path: string, field: string) => {
      const response = await manager.get(`/api/v1/${path}`);
      expect(response.status(), path).toBe(400);
      expect(response.headers()["content-type"], path).toContain("application/json");
      expect((await response.json()).details.fieldErrors, path).toHaveProperty(field);
    };

    for (const base of [
      "reports/consulting",
      "reports/lead-analysis",
      "reports/consulting/export",
      "reports/lead-analysis/export",
    ]) {
      await bad(`${base}?from=31/02/2026`, "from");
      await bad(`${base}?to=nope`, "to");
      await bad(`${base}?branchId=x`, "branchId");
      await bad(`${base}?staffId=x`, "staffId");
    }
  });

  test("a branch the user does not work in gives no leads, not an error", async ({ apiAs }) => {
    const manager = await apiAs("FITNESS_MANAGER");

    const response = await manager.get("/api/v1/reports/consulting?branchId=00000000-0000-4000-8000-0000000000ff");

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ items: [], team: { leads: 0 } });
  });

  test("only GET reads a report", async ({ apiAs }) => {
    const admin = await apiAs("ADMIN");

    for (const method of ["post", "put", "patch", "delete"] as const) {
      const response = await admin[method]("/api/v1/reports/consulting", { data: {} });
      expect([404, 405], method).toContain(response.status());
    }
  });
});
