import { afterEach, describe, expect, it, vi } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { appOrigin } from "../../src/platform/env.js";
import { notify } from "../../src/platform/notifications/notification.service.js";
import {
  getPreferences,
  getSettings,
  removeSubscription,
  saveSettings,
  savePreferences,
  saveSubscription,
  sendDueDeliveries,
} from "../../src/platform/notifications/delivery.service.js";
import type { MailProvider } from "../../src/modules/mail/mail.provider.js";
import type { PushProvider } from "../../src/platform/notifications/push.provider.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, type RoleCode } from "../support/factories.js";

afterEach(resetDatabase);

// Staff notifications by email and on the phone (M6.4; D-053, D-056; A-183 to A-187).

const T0 = new Date("2026-10-20T03:00:00.000Z");
const minutesLater = (minutes: number) => new Date(T0.getTime() + minutes * 60_000);

const keys = { p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u", auth: "tBHItJI5svbpez7KI4CCXg" };
const device = (name = "a") => ({ endpoint: `https://push.example.test/send/${name}`, keys });

/** Answers with the given results in turn, and with the last one from then on. */
function mailer(...results: Awaited<ReturnType<MailProvider["send"]>>[]) {
  let call = 0;
  return {
    send: vi.fn<MailProvider["send"]>(
      async () => results[Math.min(call++, results.length - 1)] ?? { ok: true, providerMessageId: null },
    ),
  };
}
function pusher(...results: Awaited<ReturnType<PushProvider["send"]>>[]) {
  let call = 0;
  return {
    send: vi.fn<PushProvider["send"]>(async () => results[Math.min(call++, results.length - 1)] ?? { ok: true }),
  };
}

const overdue = {
  kind: "taskOverdue",
  params: { title: "Gọi khách", due: "20/10/2026 10:00" },
  link: "/tasks/abc",
} as const;
const deliveries = (userId: string) =>
  prisma.notificationDelivery.findMany({ where: { userId }, orderBy: [{ channel: "asc" }] });

async function staff(role: RoleCode = "FITNESS_MANAGER", overrides: { locale?: "vi" | "en" } = {}) {
  const created = await createTestUser(role);
  if (overrides.locale)
    await prisma.user.update({ where: { id: created.user.id }, data: { locale: overrides.locale } });
  return created;
}

describe("which notifications go out, and by what (D-053)", () => {
  it("an important notification goes by email, and to the phone only when the app is on one", async () => {
    const { user, actor } = await staff();

    await notify(prisma, [user.id], overdue);
    expect((await deliveries(user.id)).map((d) => d.channel)).toEqual(["EMAIL"]);

    await saveSubscription(actor, device(), "Safari");
    await notify(prisma, [user.id], { ...overdue, link: "/tasks/def" });
    expect((await deliveries(user.id)).map((d) => d.channel)).toEqual(["EMAIL", "EMAIL", "PUSH"]);
  });

  it("a notification that stays in the app goes nowhere else", async () => {
    const { user } = await staff();

    await notify(prisma, [user.id], { kind: "taskCommented", params: { by: "An", title: "X" }, link: "/tasks/a" });
    await notify(prisma, [user.id], { kind: "leadNew", params: { code: "L1", name: "An" }, link: "/leads/a" });

    expect(await deliveries(user.id)).toHaveLength(0);
  });

  it("follows each employee's own choice per kind and channel", async () => {
    const { user, actor } = await staff();
    await saveSubscription(actor, device(), undefined);
    await savePreferences(actor, {
      items: [
        { kind: "taskDueSoon", email: false, push: true },
        { kind: "leadAssigned", email: true, push: false },
        { kind: "approvalSubmitted", email: false, push: false },
      ],
    });

    await notify(prisma, [user.id], { kind: "taskDueSoon", params: { title: "A", hours: "2", due: "x" }, link: null });
    await notify(prisma, [user.id], { kind: "leadAssigned", params: { code: "L1", name: "An" }, link: null });
    await notify(prisma, [user.id], { kind: "approvalSubmitted", params: { title: "HD1" }, link: null });

    const rows = await prisma.notificationDelivery.findMany({
      where: { userId: user.id },
      include: { notification: { select: { kind: true } } },
    });
    expect(rows.map((row) => `${row.notification.kind}:${row.channel}`).sort()).toEqual([
      "leadAssigned:EMAIL",
      "taskDueSoon:PUSH",
    ]);
  });

  it("a mandatory channel goes out whatever the employee chose, and a push still needs a phone", async () => {
    const { user, actor } = await staff();
    const { actor: admin } = await createTestUser("ADMIN");
    await savePreferences(actor, {
      items: [
        { kind: "taskOverdue", email: false, push: false },
        { kind: "leadReclaimed", email: false, push: false },
      ],
    });
    const settings = (await getSettings(admin)).items.map((item) =>
      item.kind === "leadReclaimed" ? { ...item, pushMandatory: true } : item,
    );
    await saveSettings(admin, { items: settings });

    // Overdue is mandatory by email from the start.
    await notify(prisma, [user.id], overdue);
    // A mandatory push with no phone has nowhere to go.
    await notify(prisma, [user.id], {
      kind: "leadReclaimed",
      params: { code: "L1", name: "An", minutes: "60" },
      link: null,
    });
    expect((await deliveries(user.id)).map((d) => d.channel)).toEqual(["EMAIL"]);

    await saveSubscription(actor, device(), undefined);
    await notify(prisma, [user.id], {
      kind: "leadReclaimed",
      params: { code: "L2", name: "An", minutes: "60" },
      link: null,
    });
    expect((await deliveries(user.id)).map((d) => d.channel).sort()).toEqual(["EMAIL", "PUSH"]);
  });

  it("an account that is no longer active gets nothing", async () => {
    const { user } = await staff();
    await prisma.user.update({ where: { id: user.id }, data: { status: "DISABLED" } });

    await notify(prisma, [user.id], overdue);

    expect(await deliveries(user.id)).toHaveLength(0);
  });
});

describe("sending (D-053)", () => {
  it("sends the email in the employee's language with the link, and the push to each device, once", async () => {
    const { user, actor } = await staff("FITNESS_MANAGER", { locale: "en" });
    await saveSubscription(actor, device("one"), undefined);
    await saveSubscription(actor, device("two"), undefined);
    await notify(prisma, [user.id], overdue);
    const mail = mailer({ ok: true, providerMessageId: "m1" });
    const push = pusher();

    const report = await sendDueDeliveries(T0, mail, push);
    const again = await sendDueDeliveries(minutesLater(5), mail, push);

    expect(report).toEqual({ sent: 2, retried: 0, failed: 0, skipped: 0 });
    expect(again).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 0 });
    expect(mail.send).toHaveBeenCalledTimes(1);
    const [email] = mail.send.mock.calls[0]!;
    expect(email).toMatchObject({ to: user.email, subject: "Task overdue" });
    expect(email.body).toContain('The task "Gọi khách" is overdue (20/10/2026 10:00)');
    expect(email.body).toContain(`${appOrigin}/tasks/abc`);
    expect(email.body).toContain("/account/notifications");
    expect(push.send).toHaveBeenCalledTimes(2);
    expect(push.send.mock.calls[0]![1]).toEqual({
      title: "Task overdue",
      body: 'The task "Gọi khách" is overdue (20/10/2026 10:00)',
      url: "/tasks/abc",
    });
    expect(await prisma.notificationDelivery.count({ where: { status: "SENT" } })).toBe(2);
  });

  it("speaks Vietnamese by default", async () => {
    const { user } = await staff();
    await notify(prisma, [user.id], overdue);
    const mail = mailer();

    await sendDueDeliveries(T0, mail, pusher());

    expect(mail.send.mock.calls[0]![0]).toMatchObject({ subject: "Việc quá hạn" });
    expect(mail.send.mock.calls[0]![0].body).toContain('Việc "Gọi khách" đã quá hạn');
  });

  it("tries a failed email again after 1, 5 and 30 minutes, and then leaves it failed", async () => {
    const { user } = await staff();
    await notify(prisma, [user.id], overdue);
    const mail = mailer({ ok: false, failure: "providerUnavailable", retry: true });
    const push = pusher();

    expect(await sendDueDeliveries(T0, mail, push)).toMatchObject({ retried: 1 });
    expect(await sendDueDeliveries(minutesLater(0.5), mail, push)).toMatchObject({ sent: 0, retried: 0 });
    expect(await sendDueDeliveries(minutesLater(2), mail, push)).toMatchObject({ retried: 1 });
    expect(await sendDueDeliveries(minutesLater(8), mail, push)).toMatchObject({ retried: 1 });
    expect(await sendDueDeliveries(minutesLater(40), mail, push)).toMatchObject({ failed: 1 });

    expect(mail.send).toHaveBeenCalledTimes(4);
    expect(await prisma.notificationDelivery.findFirstOrThrow({})).toMatchObject({
      status: "FAILED",
      attempts: 4,
      failure: "providerUnavailable",
    });
  });

  it("a refused email is not tried again", async () => {
    const { user } = await staff();
    await notify(prisma, [user.id], overdue);

    const report = await sendDueDeliveries(
      T0,
      mailer({ ok: false, failure: "providerRejected", retry: false }),
      pusher(),
    );

    expect(report).toMatchObject({ failed: 1, retried: 0 });
  });

  it("deletes a device the browser dropped, and skips the push when it was the only one", async () => {
    const { user, actor } = await staff();
    await saveSubscription(actor, device("gone"), undefined);
    await notify(prisma, [user.id], {
      ...overdue,
      kind: "leadReclaimed",
      params: { code: "L1", name: "An", minutes: "60" },
    });
    const push = pusher({ ok: false, gone: true, retry: false });

    const report = await sendDueDeliveries(T0, mailer(), push);

    expect(report).toMatchObject({ sent: 1, skipped: 1 });
    expect(await prisma.pushSubscription.count()).toBe(0);
    expect((await deliveries(user.id)).map((d) => `${d.channel}:${d.status}`)).toEqual(["EMAIL:SENT", "PUSH:SKIPPED"]);
  });

  it("sends the push to the devices that work when another one is gone", async () => {
    const { user, actor } = await staff();
    await saveSubscription(actor, device("gone"), undefined);
    await saveSubscription(actor, device("fine"), undefined);
    await notify(prisma, [user.id], overdue);
    const push = pusher({ ok: false, gone: true, retry: false }, { ok: true });

    await sendDueDeliveries(T0, mailer(), push);

    expect(await prisma.pushSubscription.count()).toBe(1);
    expect((await prisma.notificationDelivery.findMany({ where: { channel: "PUSH" } }))[0]?.status).toBe("SENT");
  });

  it("a push service that is down is tried again", async () => {
    const { user, actor } = await staff();
    await saveSubscription(actor, device(), undefined);
    await notify(prisma, [user.id], overdue);
    const push = pusher({ ok: false, gone: false, retry: true }, { ok: true });

    expect(await sendDueDeliveries(T0, mailer(), push)).toMatchObject({ sent: 1, retried: 1 });
    expect(await sendDueDeliveries(minutesLater(2), mailer(), push)).toMatchObject({ sent: 1 });
  });

  it("skips what the employee already read in the app, and accounts that are no longer active", async () => {
    const read = await staff();
    const gone = await staff();
    await notify(prisma, [read.user.id, gone.user.id], overdue);
    await prisma.notification.updateMany({ where: { userId: read.user.id }, data: { readAt: T0 } });
    await prisma.user.update({ where: { id: gone.user.id }, data: { status: "DISABLED" } });
    const mail = mailer();

    const report = await sendDueDeliveries(T0, mail, pusher());

    expect(report).toEqual({ sent: 0, retried: 0, failed: 0, skipped: 2 });
    expect(mail.send).not.toHaveBeenCalled();
  });

  it("two workers at once send each delivery once", async () => {
    const { user } = await staff();
    await notify(prisma, [user.id], overdue);
    const mail = mailer();

    await Promise.all([sendDueDeliveries(T0, mail, pusher()), sendDueDeliveries(T0, mail, pusher())]);

    expect(mail.send).toHaveBeenCalledTimes(1);
  });
});

describe("the employee's choices and the devices", () => {
  it("start with everything on, show what Admin made mandatory, and keep what was chosen", async () => {
    const { actor } = await staff();

    const first = await getPreferences(actor);
    expect(first.pushDevices).toBe(0);
    expect(first.items).toHaveLength(7);
    expect(first.items.every((item) => item.email && item.push)).toBe(true);
    expect(first.items.find((item) => item.kind === "taskOverdue")).toMatchObject({
      emailMandatory: true,
      pushMandatory: false,
    });
    expect(first.items.find((item) => item.kind === "taskDueSoon")).toMatchObject({ emailMandatory: false });

    const saved = await savePreferences(actor, { items: [{ kind: "taskDueSoon", email: false, push: true }] });
    expect(saved.items.find((item) => item.kind === "taskDueSoon")).toMatchObject({ email: false, push: true });
    expect(saved.items.find((item) => item.kind === "leadAssigned")).toMatchObject({ email: true, push: true });
  });

  it("refuses a kind that never goes out, a repeated kind and a non-boolean", async () => {
    const { actor } = await staff();

    for (const items of [
      [{ kind: "taskCommented", email: true, push: true }],
      [
        { kind: "taskOverdue", email: true, push: true },
        { kind: "taskOverdue", email: false, push: true },
      ],
      [{ kind: "taskOverdue", email: "yes", push: true }],
    ]) {
      await expect(savePreferences(actor, { items })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });

  it("remembers a device once, moves it to the next employee who signs in on it, and removes only one's own", async () => {
    const first = await staff();
    const second = await staff("RECEPTIONIST");

    await saveSubscription(first.actor, device(), "Chrome");
    await saveSubscription(first.actor, device(), "Chrome");
    expect(await prisma.pushSubscription.count()).toBe(1);

    await saveSubscription(second.actor, device(), "Chrome");
    expect((await prisma.pushSubscription.findFirstOrThrow({})).userId).toBe(second.user.id);

    await removeSubscription(first.actor, { endpoint: device().endpoint });
    expect(await prisma.pushSubscription.count()).toBe(1);
    await removeSubscription(second.actor, { endpoint: device().endpoint });
    expect(await prisma.pushSubscription.count()).toBe(0);
  });

  it("takes only an https endpoint and keys", async () => {
    const { actor } = await staff();

    for (const input of [
      { endpoint: "http://push.example.test/x", keys },
      { endpoint: "javascript:alert(1)", keys },
      { endpoint: "https://push.example.test/x", keys: { p256dh: "", auth: "" } },
      {},
    ]) {
      await expect(saveSubscription(actor, input, undefined)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    }
    await expect(removeSubscription(actor, { endpoint: "ftp://x" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
  });

  it("Admin marks the mandatory channels, audited; nobody else does", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const saved = await saveSettings(admin, {
      items: [{ kind: "taskDueSoon", emailMandatory: true, pushMandatory: true }],
    });

    expect(saved.items.find((item) => item.kind === "taskDueSoon")).toEqual({
      kind: "taskDueSoon",
      emailMandatory: true,
      pushMandatory: true,
    });
    expect(await prisma.auditEvent.findFirst({ where: { action: "notification_settings.updated" } })).toMatchObject({
      actorUserId: admin.id,
    });
    for (const role of ["FITNESS_MANAGER", "RECEPTIONIST", "PT", "ACCOUNTANT"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(getSettings(actor)).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(saveSettings(actor, { items: [] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    await expect(
      saveSettings(admin, { items: [{ kind: "taskCommented", emailMandatory: true, pushMandatory: false }] }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
