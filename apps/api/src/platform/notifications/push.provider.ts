import webpush from "web-push";
import { env } from "../env.js";

// The push service behind one small interface, like the mail provider (D-053, D-056, T-051). Only this file knows the Web
// Push protocol, so tests mock the provider at this boundary. A push carries a title, a sentence and the page to open.

export type PushTarget = { endpoint: string; p256dh: string; auth: string };

export type PushMessage = { title: string; body: string; url: string };

export type PushResult =
  | { ok: true }
  // `gone`: the browser has dropped the subscription (404, 410), so it is deleted; `retry`: worth another try later.
  | { ok: false; gone: boolean; retry: boolean };

export interface PushProvider {
  send(target: PushTarget, message: PushMessage): Promise<PushResult>;
}

/** How long a push service keeps a message for a phone that is off: an hour is long enough to still matter. */
const TTL_SECONDS = 3600;
const SEND_TIMEOUT_MS = 10_000;

export type WebPushOptions = { publicKey: string; privateKey: string; subject: string };

export function createWebPushProvider({ publicKey, privateKey, subject }: WebPushOptions): PushProvider {
  return {
    async send(target, message) {
      try {
        await webpush.sendNotification(
          { endpoint: target.endpoint, keys: { p256dh: target.p256dh, auth: target.auth } },
          JSON.stringify(message),
          { vapidDetails: { subject, publicKey, privateKey }, TTL: TTL_SECONDS, timeout: SEND_TIMEOUT_MS },
        );
        return { ok: true };
      } catch (error) {
        const status =
          typeof error === "object" && error !== null && "statusCode" in error ? Number(error.statusCode) : 0;
        if (status === 404 || status === 410) return { ok: false, gone: true, retry: false };
        // Busy (429), broken (5xx) or unreachable (no status) is worth another try; a refusal (bad key, too large) is not.
        return { ok: false, gone: false, retry: status === 0 || status === 429 || status >= 500 };
      }
    },
  };
}

/** Development and tests: nothing leaves the machine; the log says only that a push would have gone out. */
export function createLogPushProvider(): PushProvider {
  return {
    async send() {
      console.info(JSON.stringify({ time: new Date().toISOString(), level: "info", type: "push" }));
      return { ok: true };
    },
  };
}

export function configuredPushProvider(): PushProvider {
  return env.PUSH_PROVIDER === "webpush"
    ? createWebPushProvider({
        publicKey: env.VAPID_PUBLIC_KEY ?? "",
        privateKey: env.VAPID_PRIVATE_KEY ?? "",
        subject: env.VAPID_SUBJECT ?? "",
      })
    : createLogPushProvider();
}

/** The key a browser subscribes with; empty while push is not set up, and the screens then say so. */
export function pushPublicKey(): string {
  return env.PUSH_PROVIDER === "webpush" ? (env.VAPID_PUBLIC_KEY ?? "") : "";
}
