// OWASP A01 (access control), A03 (a subject cannot add headers) and A10 (input errors) for the email templates of
// M6.2 (brief §8.3; D-036; FR-MAIL-001). The templates are shared by the whole system, so the writes here only use
// the refused inputs and put nothing in.
import { expect, test } from "../fixtures";
import type { Role } from "../support/db";

const ROLES: Role[] = ["ADMIN", "FITNESS_MANAGER", "RECEPTIONIST", "CONSULTING", "PT", "ACCOUNTANT"];
const EVENT = "session.refunded";

type Template = { subjectVi: string; bodyVi: string; subjectEn: string; bodyEn: string };

test.describe("A01 only admin reads and writes the words customers are sent", () => {
  for (const role of ROLES) {
    const status = role === "ADMIN" ? 200 : 403;
    test(`${role} reading and writing the templates gets ${status}`, async ({ apiAs }) => {
      const api = await apiAs(role);
      const admin = await apiAs("ADMIN");
      const current = (await (await admin.get(`/api/v1/email-templates/${EVENT}`)).json()) as Template;

      expect((await api.get("/api/v1/email-templates")).status()).toBe(status);
      expect((await api.get(`/api/v1/email-templates/${EVENT}`)).status()).toBe(status);
      // Writing back what is there changes nothing, but is still refused to everyone but admin.
      const { subjectVi, bodyVi, subjectEn, bodyEn } = current;
      const put = await api.put(`/api/v1/email-templates/${EVENT}`, { data: { subjectVi, bodyVi, subjectEn, bodyEn } });
      expect(put.status()).toBe(status);
    });
  }

  test("an anonymous request gets 401", async ({ apiAs }) => {
    const anonymous = await apiAs(null);
    expect((await anonymous.get("/api/v1/email-templates")).status()).toBe(401);
    expect((await anonymous.put(`/api/v1/email-templates/${EVENT}`, { data: {} })).status()).toBe(401);
  });
});

test.describe("A03 and A10 the inputs", () => {
  test("a bad template is a 400, a header cannot be added through the subject, and an unknown event is a 404", async ({
    apiAs,
  }) => {
    const admin = await apiAs("ADMIN");
    const base = (await (await admin.get(`/api/v1/email-templates/${EVENT}`)).json()) as Template;
    const put = (data: Record<string, unknown>, event = EVENT) =>
      admin.put(`/api/v1/email-templates/${event}`, { data });

    for (const data of [
      {},
      { ...base, subjectVi: "Hoàn buổi\r\nBcc: attacker@example.com" },
      { ...base, subjectEn: "x".repeat(201) },
      { ...base, bodyVi: "" },
      { ...base, bodyEn: "bell\u0007" },
      { ...base, bodyVi: "x".repeat(5001) },
      // A placeholder the event does not offer, and a body without the reason it must give.
      { ...base, bodyVi: "{remaining} {reason} {className}" },
      { ...base, bodyEn: "Left: {remaining}" },
    ]) {
      expect((await put(data)).status(), JSON.stringify(data).slice(0, 60)).toBe(400);
    }
    expect((await put(base, "contract.activated")).status()).toBe(404);
    expect((await admin.get("/api/v1/email-templates/nope")).status()).toBe(404);
    expect((await admin.get("/api/v1/email-templates/..%2Fadmin")).status()).toBe(404);
  });
});
