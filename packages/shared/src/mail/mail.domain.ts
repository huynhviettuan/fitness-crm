/** Customer email (D-036, D-059): the states of an outbox row and when a failed send is tried again. Pure rules. */

export const EMAIL_STATUSES = ["QUEUED", "SENT", "FAILED"] as const;
export type EmailStatus = (typeof EMAIL_STATUSES)[number];

/** Why an email failed; the web app turns the code into text. */
export const EMAIL_FAILURES = ["noEmail", "providerRejected", "providerUnavailable"] as const;
export type EmailFailure = (typeof EMAIL_FAILURES)[number];

export const EMAIL_LOCALES = ["vi", "en"] as const;
export type EmailLocale = (typeof EMAIL_LOCALES)[number];

/** Minutes to wait after the first, second, and third failed attempt; a fourth failure is final. */
export const RETRY_DELAY_MINUTES = [1, 5, 30] as const;
export const MAX_EMAIL_ATTEMPTS = RETRY_DELAY_MINUTES.length + 1;

/** When to try again after `attempts` attempts have failed, or null when the email is given up. */
export function nextAttemptAt(attempts: number, now: Date): Date | null {
  const delay = RETRY_DELAY_MINUTES[attempts - 1];
  return delay === undefined ? null : new Date(now.getTime() + delay * 60_000);
}

/** An event key such as "session.credited": lowercase words joined by dots. */
export const EVENT_KEY_PATTERN = /^[a-z][a-zA-Z0-9]*(\.[a-z][a-zA-Z0-9]*)*$/;
