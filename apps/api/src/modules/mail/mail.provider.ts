import type { EmailFailure } from "@flow/shared/mail";
import { env } from "../../platform/env.js";

// The email provider behind one small interface (T-051). Resend is the recommended one; Amazon SES would be another
// implementation of `MailProvider`. Only this file knows the provider's HTTP API, so tests mock it at `fetch`.

export type OutgoingEmail = {
  to: string;
  subject: string;
  /** Plain text; templates (M6.2) decide what it says. */
  body: string;
  /** The outbox row's id: a retry of one email never becomes two at the provider. */
  idempotencyKey: string;
};

export type SendResult =
  | { ok: true; providerMessageId: string | null }
  // `retry`: the same email may succeed later (the provider was down or busy); otherwise it was refused for good.
  | { ok: false; failure: EmailFailure; retry: boolean };

export interface MailProvider {
  send(email: OutgoingEmail): Promise<SendResult>;
}

const RESEND_URL = "https://api.resend.com/emails";
const SEND_TIMEOUT_MS = 10_000;

export type ResendOptions = { apiKey: string; from: string; fetch?: typeof fetch };

export function createResendProvider({ apiKey, from, fetch: fetcher = fetch }: ResendOptions): MailProvider {
  return {
    async send(email) {
      let response: Response;
      try {
        response = await fetcher(RESEND_URL, {
          method: "POST",
          headers: {
            authorization: `Bearer ${apiKey}`,
            "content-type": "application/json",
            "idempotency-key": email.idempotencyKey,
          },
          body: JSON.stringify({ from, to: [email.to], subject: email.subject, text: email.body }),
          signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
        });
      } catch {
        return { ok: false, failure: "providerUnavailable", retry: true };
      }
      if (response.ok) {
        const data: unknown = await response.json().catch(() => null);
        const id = data && typeof data === "object" && "id" in data && typeof data.id === "string" ? data.id : null;
        return { ok: true, providerMessageId: id };
      }
      // Busy (429) or broken (5xx) is worth another try; any other refusal (bad address, bad key) is not.
      const temporary = response.status === 429 || response.status >= 500;
      return temporary
        ? { ok: false, failure: "providerUnavailable", retry: true }
        : { ok: false, failure: "providerRejected", retry: false };
    },
  };
}

/** Development and tests: nothing leaves the machine; the log says only that an email would have gone out. */
export function createLogProvider(): MailProvider {
  return {
    async send(email) {
      console.info(
        JSON.stringify({ time: new Date().toISOString(), level: "info", type: "mail", id: email.idempotencyKey }),
      );
      return { ok: true, providerMessageId: `log:${email.idempotencyKey}` };
    },
  };
}

export function configuredMailProvider(): MailProvider {
  return env.EMAIL_PROVIDER === "resend"
    ? createResendProvider({ apiKey: env.RESEND_API_KEY ?? "", from: env.EMAIL_FROM ?? "" })
    : createLogProvider();
}
