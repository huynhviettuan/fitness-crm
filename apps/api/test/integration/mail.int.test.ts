import { afterEach, describe, expect, it, vi } from "vitest";
import { PARAMETER_DEFAULTS } from "@flow/shared/parameters";
import { prisma } from "../../src/platform/db/prisma.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { createLogProvider, createResendProvider } from "../../src/modules/mail/mail.provider.js";
import {
  getCustomerEmail,
  listCustomerEmails,
  queueEmail,
  sendDueEmails,
} from "../../src/modules/mail/mail.service.js";
import { updateParameters } from "../../src/platform/parameters/parameter.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestBranch, createTestOption, createTestUser, uniquePhone } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

const T0 = new Date("2026-10-20T03:00:00.000Z");
const minutesLater = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

/** The provider's HTTP API, mocked at `fetch` (the boundary), answering with the given statuses in turn. */
function resend(...statuses: number[]) {
  const answers = [...statuses];
  const fetchMock = vi.fn<typeof fetch>(async () => {
    const status = answers.length > 1 ? answers.shift()! : answers[0]!;
    return new Response(JSON.stringify(status === 200 ? { id: "re_123" } : { message: "no" }), { status });
  });
  return {
    fetchMock,
    provider: createResendProvider({ apiKey: "re_test", from: "Flow <no-reply@flow.test>", fetch: fetchMock }),
  };
}

async function customerWithEmail(email: string | null = "an@example.test") {
  const { actor } = await createTestUser("RECEPTIONIST");
  const customer = await createCustomer(actor, {
    fullName: "Nguyễn Văn An",
    phone: uniquePhone(),
    ...(email ? { email } : {}),
  });
  return { actor, customer };
}

const mail = (personId: string, by: string | null, overrides: Partial<Parameters<typeof queueEmail>[1]> = {}) => ({
  personId,
  event: "session.credited",
  dedupeKey: `session.credited:${personId}:1`,
  locale: "vi" as const,
  subject: "Buổi tập đã ghi nhận",
  body: "Bạn còn 9 buổi.",
  by,
  ...overrides,
});

const rowsOf = (personId: string) =>
  prisma.emailMessage.findMany({ where: { personId }, orderBy: { createdAt: "asc" } });

describe("sending the outbox (D-036, FR-MAIL-003)", () => {
  it("sends a queued email through the provider with the row's id as its idempotency key", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    const { fetchMock, provider } = resend(200);

    expect(await sendDueEmails(T0, provider)).toEqual({ sent: 1, retried: 0, failed: 0 });

    const [row] = await rowsOf(customer.id);
    expect(row).toMatchObject({
      status: "SENT",
      attempts: 1,
      providerMessageId: "re_123",
      sentAt: T0,
      failure: null,
      toAddress: "an@example.test",
    });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe("https://api.resend.com/emails");
    const headers = init?.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_test");
    expect(headers["idempotency-key"]).toBe(row!.id);
    expect(JSON.parse(String(init?.body))).toEqual({
      from: "Flow <no-reply@flow.test>",
      to: ["an@example.test"],
      subject: "Buổi tập đã ghi nhận",
      text: "Bạn còn 9 buổi.",
    });
    // Nothing is sent twice.
    expect(await sendDueEmails(minutesLater(5), provider)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("queues one email per cause, however often the cause is replayed", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    await queueEmail(prisma, mail(customer.id, actor.id, { subject: "Khác" }));

    expect(await rowsOf(customer.id)).toHaveLength(1);
    expect((await rowsOf(customer.id))[0]).toMatchObject({ subject: "Buổi tập đã ghi nhận" });
  });

  it("queues nothing when the change that caused it is rolled back", async () => {
    const { actor, customer } = await customerWithEmail();

    await expect(
      prisma.$transaction(async (tx) => {
        await queueEmail(tx, mail(customer.id, actor.id));
        throw new Error("rolled back");
      }),
    ).rejects.toThrow("rolled back");

    expect(await rowsOf(customer.id)).toEqual([]);
  });

  it("tries again after 1, 5, and 30 minutes, then fails once with one task for reception", async () => {
    const { actor, customer } = await customerWithEmail();
    const { actor: admin } = await createTestUser("ADMIN");
    const reception = await createTestOption("departments", "Lễ tân");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, receptionDepartmentId: reception });
    await queueEmail(prisma, mail(customer.id, actor.id));
    const { fetchMock, provider } = resend(503);

    expect(await sendDueEmails(T0, provider)).toEqual({ sent: 0, retried: 1, failed: 0 });
    expect(await sendDueEmails(T0, provider)).toEqual({ sent: 0, retried: 0, failed: 0 });
    let [row] = await rowsOf(customer.id);
    expect(row).toMatchObject({
      status: "QUEUED",
      attempts: 1,
      failure: "providerUnavailable",
      nextAttemptAt: minutesLater(1),
    });

    expect(await sendDueEmails(minutesLater(1), provider)).toMatchObject({ retried: 1 });
    expect(await sendDueEmails(minutesLater(6), provider)).toMatchObject({ retried: 1 });
    [row] = await rowsOf(customer.id);
    expect(row).toMatchObject({ attempts: 3, nextAttemptAt: minutesLater(36) });
    expect(await prisma.task.count({ where: { source: "mail" } })).toBe(0);

    expect(await sendDueEmails(minutesLater(36), provider)).toEqual({ sent: 0, retried: 0, failed: 1 });
    [row] = await rowsOf(customer.id);
    expect(row).toMatchObject({ status: "FAILED", attempts: 4, failure: "providerUnavailable" });
    expect(fetchMock).toHaveBeenCalledTimes(4);

    const tasks = await prisma.task.findMany({ where: { source: "mail" } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      assigneeDepartmentId: reception,
      assignerId: actor.id,
      entityType: "customer",
      entityId: customer.id,
      branchId: customer.branch.id,
    });
    expect(row!.failureTaskId).toBe(tasks[0]!.id);

    // A failed email is not tried again and makes no second task.
    expect(await sendDueEmails(minutesLater(500), provider)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(await prisma.task.count({ where: { source: "mail" } })).toBe(1);
  });

  it("does not try again when the provider refuses the email for good", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    const { fetchMock, provider } = resend(422);

    expect(await sendDueEmails(T0, provider)).toEqual({ sent: 0, retried: 0, failed: 1 });

    expect((await rowsOf(customer.id))[0]).toMatchObject({
      status: "FAILED",
      attempts: 1,
      failure: "providerRejected",
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("treats a network error and a busy provider as worth another try", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    const offline = createResendProvider({
      apiKey: "k",
      from: "f@flow.test",
      fetch: vi.fn(async () => {
        throw new TypeError("fetch failed");
      }),
    });
    expect(await sendDueEmails(T0, offline)).toMatchObject({ retried: 1 });

    const busy = resend(429);
    expect(await sendDueEmails(minutesLater(1), busy.provider)).toMatchObject({ retried: 1 });
    expect((await rowsOf(customer.id))[0]).toMatchObject({ status: "QUEUED", attempts: 2 });
  });

  it("fails at once for a customer without an email address, with a task, and never calls the provider", async () => {
    const { actor, customer } = await customerWithEmail(null);
    const { actor: admin } = await createTestUser("ADMIN");
    const reception = await createTestOption("departments", "Lễ tân");
    await updateParameters(admin, { ...PARAMETER_DEFAULTS, receptionDepartmentId: reception });

    await queueEmail(prisma, mail(customer.id, actor.id));

    const [row] = await rowsOf(customer.id);
    expect(row).toMatchObject({ status: "FAILED", failure: "noEmail", toAddress: null, attempts: 0 });
    expect(await prisma.task.count({ where: { source: "mail", assigneeDepartmentId: reception } })).toBe(1);
    const { fetchMock, provider } = resend(200);
    expect(await sendDueEmails(T0, provider)).toEqual({ sent: 0, retried: 0, failed: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("still shows the failure when no reception department is set, and the author falls back to an admin", async () => {
    const { customer } = await customerWithEmail(null);
    await createTestUser("ADMIN", { allBranches: true });

    await queueEmail(prisma, mail(customer.id, null));

    expect((await rowsOf(customer.id))[0]).toMatchObject({ status: "FAILED", failure: "noEmail", failureTaskId: null });
    expect(await prisma.task.count({ where: { source: "mail" } })).toBe(0);
  });

  it("keeps the address the email was queued with when the customer's email changes later", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    await prisma.customer.update({ where: { id: customer.id }, data: { email: "new@example.test" } });
    const { fetchMock, provider } = resend(200);

    await sendDueEmails(T0, provider);

    expect(JSON.parse(String(fetchMock.mock.calls[0]![1]?.body)).to).toEqual(["an@example.test"]);
  });

  it("lets two runs at once send an email only once", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    const { fetchMock, provider } = resend(200);

    await Promise.all([sendDueEmails(T0, provider), sendDueEmails(T0, provider)]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe("queueEmail input", () => {
  it("refuses a subject with a line break (header injection), a bad event key, and an unknown customer", async () => {
    const { actor, customer } = await customerWithEmail();

    await expect(
      queueEmail(prisma, mail(customer.id, actor.id, { subject: "Hi\r\nBcc: x@y.z" })),
    ).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(queueEmail(prisma, mail(customer.id, actor.id, { event: "Not An Event" }))).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(queueEmail(prisma, mail("a0000000-0000-4000-8000-000000000009", actor.id))).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
    expect(await rowsOf(customer.id)).toEqual([]);
  });
});

describe("the Emails sent tab (FR-MAIL-003)", () => {
  it("lists a customer's emails newest first with status and attempts", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id, { dedupeKey: "a", subject: "Một" }));
    await queueEmail(prisma, mail(customer.id, actor.id, { dedupeKey: "b", subject: "Hai" }));
    await sendDueEmails(T0, resend(200).provider);

    const page = await listCustomerEmails(actor, customer.id, { pageSize: 1 });

    expect(page).toMatchObject({ total: 2, page: 1, pageSize: 1 });
    expect(page.items).toEqual([
      expect.objectContaining({
        subject: "Hai",
        status: "SENT",
        attempts: 1,
        toAddress: "an@example.test",
        failure: null,
      }),
    ]);
  });

  it("hides the address from a role that may not see emails", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));

    const page = await listCustomerEmails({ ...actor, masks: new Set(["customer.email"]) }, customer.id, {});

    expect(page.items[0]).toMatchObject({ toAddress: null, subject: "Buổi tập đã ghi nhận" });
  });

  it("shows only customers in scope: other branches, own-only roles, and bad ids are NOT_FOUND", async () => {
    const { actor, customer } = await customerWithEmail();
    const { actor: trainer } = await createTestUser("PT");
    const otherBranch = await createTestBranch();
    const { actor: outsider } = await createTestUser("RECEPTIONIST", { branchIds: [otherBranch.id] });

    await expect(listCustomerEmails(trainer, customer.id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listCustomerEmails(outsider, customer.id, {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listCustomerEmails(actor, "not-a-uuid", {})).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(listCustomerEmails(actor, customer.id, { pageSize: 1000 })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });
});

describe("one email with what it said (A-317)", () => {
  it("shows the subject and body, and whether it was only recorded", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id, { dedupeKey: "sent" }));
    await sendDueEmails(T0, resend(200).provider);
    await queueEmail(prisma, mail(customer.id, actor.id, { dedupeKey: "logged", subject: "Chỉ ghi" }));
    await sendDueEmails(minutesLater(1), createLogProvider());
    const [sent, logged] = await rowsOf(customer.id);

    expect(await getCustomerEmail(actor, customer.id, sent!.id)).toMatchObject({
      subject: "Buổi tập đã ghi nhận",
      body: "Bạn còn 9 buổi.",
      toAddress: "an@example.test",
      status: "SENT",
      recordedOnly: false,
    });
    expect(await getCustomerEmail(actor, customer.id, logged!.id)).toMatchObject({
      status: "SENT",
      recordedOnly: true,
    });
    const page = await listCustomerEmails(actor, customer.id, {});
    expect(page.items.map((item) => item.recordedOnly).sort()).toEqual([false, true]);
  });

  it("hides the address from a role that may not see emails", async () => {
    const { actor, customer } = await customerWithEmail();
    await queueEmail(prisma, mail(customer.id, actor.id));
    const [row] = await rowsOf(customer.id);

    const email = await getCustomerEmail({ ...actor, masks: new Set(["customer.email"]) }, customer.id, row!.id);
    expect(email).toMatchObject({ toAddress: null, body: "Bạn còn 9 buổi." });
  });

  it("is NOT_FOUND out of scope, under another customer, or for a bad id; FORBIDDEN without customer.view", async () => {
    const { actor, customer } = await customerWithEmail();
    const { customer: other } = await customerWithEmail("other@example.test");
    await queueEmail(prisma, mail(customer.id, actor.id));
    const [row] = await rowsOf(customer.id);
    const { actor: trainer } = await createTestUser("PT");
    const otherBranch = await createTestBranch();
    const { actor: outsider } = await createTestUser("RECEPTIONIST", { branchIds: [otherBranch.id] });

    for (const [who, customerId, emailId] of [
      [trainer, customer.id, row!.id],
      [outsider, customer.id, row!.id],
      [actor, other.id, row!.id],
      [actor, customer.id, "not-a-uuid"],
      [actor, "not-a-uuid", row!.id],
    ] as const) {
      await expect(getCustomerEmail(who, customerId, emailId)).rejects.toMatchObject({ code: "NOT_FOUND" });
    }
    await expect(getCustomerEmail({ ...actor, permissions: new Set() }, customer.id, row!.id)).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
  });
});
