// OWASP A01 (access control, data scope), A02 (no message body in the list; the body only on one email, for those who see
// the customer), A10 (input errors) for the customer's emails (M4.0, FR-MAIL-003; one email, A-317). Route-level 401s are covered by the route inventory in
// access-control.spec.ts.
import { randomUUID } from "node:crypto";
import { expect, test } from "../fixtures";
import { createCustomerViaApi } from "../support/data";
import { insertEmailRow } from "../support/db";

test.describe("A01 the emails of a customer (docs/09)", () => {
  test("reception reads them; a trainer, who sees only their own customers, gets 404", async ({ apiAs, testTag }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    await insertEmailRow(customer.id, { subject: `Thư ${testTag}`, status: "SENT" });

    const reception = await (await apiAs("RECEPTIONIST")).get(`/api/v1/customers/${customer.id}/emails`);
    expect(reception.status()).toBe(200);
    expect((await reception.json()).items).toHaveLength(1);

    const trainer = await (await apiAs("PT")).get(`/api/v1/customers/${customer.id}/emails`);
    expect(trainer.status()).toBe(404);
  });

  test("one email: out of scope, or asked under another customer, is 404 (A-317)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    const other = await createCustomerViaApi(reception, `${testTag}-khac`);
    await insertEmailRow(customer.id, { subject: `Thư ${testTag}`, status: "SENT" });
    const [email] = (await (await reception.get(`/api/v1/customers/${customer.id}/emails`)).json()).items;

    expect((await reception.get(`/api/v1/customers/${customer.id}/emails/${email.id}`)).status()).toBe(200);
    expect((await (await apiAs("PT")).get(`/api/v1/customers/${customer.id}/emails/${email.id}`)).status()).toBe(404);
    expect((await reception.get(`/api/v1/customers/${other.id}/emails/${email.id}`)).status()).toBe(404);
  });

  test("a consultant sees the emails of customers they created only (A-029)", async ({ apiAs, testTag }) => {
    const others = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    const own = await createCustomerViaApi(await apiAs("CONSULTING"), `${testTag}-own`);
    const consultant = await apiAs("CONSULTING");

    expect((await consultant.get(`/api/v1/customers/${others.id}/emails`)).status()).toBe(404);
    expect((await consultant.get(`/api/v1/customers/${own.id}/emails`)).status()).toBe(200);
  });
});

test.describe("A02 what the list returns", () => {
  test("it carries no message body and no provider details", async ({ apiAs, testTag }) => {
    const customer = await createCustomerViaApi(await apiAs("RECEPTIONIST"), testTag);
    await insertEmailRow(customer.id, { subject: `Thư ${testTag}`, status: "SENT" });

    const body = await (await (await apiAs("RECEPTIONIST")).get(`/api/v1/customers/${customer.id}/emails`)).json();

    expect(Object.keys(body.items[0]).sort()).toEqual(
      [
        "attempts",
        "createdAt",
        "event",
        "failure",
        "id",
        "locale",
        "recordedOnly",
        "sentAt",
        "status",
        "subject",
        "toAddress",
      ].sort(),
    );
  });

  test("one email adds its body and nothing of the provider (A-317)", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);
    await insertEmailRow(customer.id, {
      subject: `Thư ${testTag}`,
      status: "SENT",
      providerMessageId: "log:secret-id",
    });
    const [email] = (await (await reception.get(`/api/v1/customers/${customer.id}/emails`)).json()).items;

    const answer = await reception.get(`/api/v1/customers/${customer.id}/emails/${email.id}`);
    expect(answer.status()).toBe(200);
    const body = await answer.json();
    expect(body).toMatchObject({ subject: `Thư ${testTag}`, body: "Nội dung", recordedOnly: true });
    expect(Object.keys(body)).toContain("body");
    expect(JSON.stringify(body)).not.toContain("secret-id");
  });
});

test.describe("A10 input errors", () => {
  test("an unknown id is 404 and a bad page size is a 400, not a server error", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await createCustomerViaApi(reception, testTag);

    expect((await reception.get(`/api/v1/customers/${randomUUID()}/emails`)).status()).toBe(404);
    expect((await reception.get(`/api/v1/customers/not-a-uuid/emails`)).status()).toBe(404);
    expect((await reception.get(`/api/v1/customers/${customer.id}/emails?pageSize=1000`)).status()).toBe(400);
    expect((await reception.get(`/api/v1/customers/${customer.id}/emails?page=abc`)).status()).toBe(400);
    expect((await reception.get(`/api/v1/customers/${customer.id}/emails/${randomUUID()}`)).status()).toBe(404);
    expect((await reception.get(`/api/v1/customers/${customer.id}/emails/not-a-uuid`)).status()).toBe(404);
  });
});
