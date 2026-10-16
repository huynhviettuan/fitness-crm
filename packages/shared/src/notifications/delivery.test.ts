import { describe, expect, it } from "vitest";
import {
  EXTERNAL_NOTIFICATION_KINDS,
  NOTIFICATION_KINDS,
  NOTIFICATION_TEXTS,
  channelsFor,
  isExternalKind,
  notificationPreferencesInputSchema,
  notificationText,
  notificationTitle,
  pushSubscriptionInputSchema,
} from "./index.js";

describe("which channels a notification goes out by (D-053)", () => {
  it("goes by email and push until the employee chooses, push only to a phone with the app", () => {
    expect(channelsFor(null, null, true)).toEqual(["EMAIL", "PUSH"]);
    expect(channelsFor(null, null, false)).toEqual(["EMAIL"]);
  });

  it("follows the employee's choice, per channel", () => {
    expect(channelsFor({ email: false, push: true }, null, true)).toEqual(["PUSH"]);
    expect(channelsFor({ email: true, push: false }, null, true)).toEqual(["EMAIL"]);
    expect(channelsFor({ email: false, push: false }, null, true)).toEqual([]);
  });

  it("a mandatory channel goes out whatever the employee chose, but a push needs a phone", () => {
    const off = { email: false, push: false };
    expect(channelsFor(off, { email: true, push: false }, true)).toEqual(["EMAIL"]);
    expect(channelsFor(off, { email: false, push: true }, true)).toEqual(["PUSH"]);
    expect(channelsFor(off, { email: false, push: true }, false)).toEqual([]);
  });

  it("knows the external kinds, all of them real kinds", () => {
    for (const kind of EXTERNAL_NOTIFICATION_KINDS) expect(NOTIFICATION_KINDS).toContain(kind);
    expect(isExternalKind("taskOverdue")).toBe(true);
    expect(isExternalKind("taskCommented")).toBe(false);
  });
});

describe("the words of a notification outside the app", () => {
  it("fills the values in the employee's language", () => {
    expect(notificationText("taskOverdue", { title: "Gọi khách", due: "20/10/2026 10:00" }, "vi")).toBe(
      'Việc "Gọi khách" đã quá hạn (20/10/2026 10:00)',
    );
    expect(notificationText("leadAssigned", { code: "L001", name: "An" }, "en")).toBe(
      "Lead L001 · An was assigned to you",
    );
    expect(notificationText("leadStepDue", { code: "L1", name: "An", stepVi: "Gọi", stepEn: "Call" }, "en")).toBe(
      "Due: Call · lead L1 · An",
    );
    expect(notificationText("taskOverdue", {}, "en")).toBe('The task "" is overdue ()');
  });

  it("has a text and a title in both languages for everything that goes out", () => {
    for (const locale of ["vi", "en"] as const) {
      for (const kind of NOTIFICATION_KINDS) expect(NOTIFICATION_TEXTS[locale][kind].length).toBeGreaterThan(0);
      for (const kind of EXTERNAL_NOTIFICATION_KINDS) expect(notificationTitle(kind, locale).length).toBeGreaterThan(0);
    }
  });
});

describe("the inputs", () => {
  it("takes one choice per external kind, once", () => {
    const ok = { items: [{ kind: "taskOverdue", email: false, push: true }] };
    expect(notificationPreferencesInputSchema.safeParse(ok).success).toBe(true);
    expect(notificationPreferencesInputSchema.safeParse({ items: [ok.items[0], ok.items[0]] }).success).toBe(false);
    expect(
      notificationPreferencesInputSchema.safeParse({ items: [{ kind: "taskCommented", email: true, push: true }] })
        .success,
    ).toBe(false);
    expect(
      notificationPreferencesInputSchema.safeParse({ items: [{ kind: "taskOverdue", email: "yes", push: true }] })
        .success,
    ).toBe(false);
  });

  it("takes only an https push endpoint with its keys", () => {
    const keys = {
      p256dh: "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u",
      auth: "tBHItJI5svbpez7KI4CCXg",
    };
    expect(
      pushSubscriptionInputSchema.safeParse({ endpoint: "https://fcm.googleapis.com/fcm/send/abc", keys }).success,
    ).toBe(true);
    expect(pushSubscriptionInputSchema.safeParse({ endpoint: "http://fcm.googleapis.com/x", keys }).success).toBe(
      false,
    );
    expect(pushSubscriptionInputSchema.safeParse({ endpoint: "javascript:alert(1)", keys }).success).toBe(false);
    expect(
      pushSubscriptionInputSchema.safeParse({ endpoint: "https://x.example/p", keys: { p256dh: "", auth: "" } })
        .success,
    ).toBe(false);
  });
});
