import { z } from "zod";

// Gmail forwarding (M10.5; brief §11, D-044; A-287 to A-293). The gym's Gmail forwards what it receives to an address of an
// inbound-mail service (Postmark Inbound), which posts each email to us as JSON. Read here, purely: who wrote, what they said, and
// whether it is an email a person wrote at all (not Gmail's own confirmation, an auto-reply, a bounce or a mailing list).

/** The same cap as every message (`MAX_MESSAGE_LENGTH` in the domain). */
const MAX_MESSAGE_LENGTH = 4000;

/** Postmark's inbound webhook body, the fields we use; anything else it sends is ignored. */
export const inboundEmailSchema = z.object({
  MessageID: z.string().min(1).max(300),
  FromFull: z.object({ Email: z.string().max(320), Name: z.string().max(300).optional() }),
  Subject: z.string().max(2000).optional(),
  TextBody: z.string().optional(),
  HtmlBody: z.string().optional(),
  StrippedTextReply: z.string().optional(),
  Date: z.string().optional(),
  Headers: z.array(z.object({ Name: z.string(), Value: z.string() })).optional(),
  Attachments: z.array(z.object({ Name: z.string().max(300).optional() })).optional(),
});
export type InboundEmailBody = z.input<typeof inboundEmailSchema>;

/** Gmail's own address for the confirmation of a forwarding rule. */
const GMAIL_FORWARDING = "forwarding-noreply@google.com";

export type InboundEmail =
  | {
      kind: "message";
      externalId: string;
      email: string;
      name: string;
      phone: string | null;
      body: string;
      receivedAt: Date | null;
    }
  /** Gmail asks the forwarding address to confirm the rule: Admin needs the code, it is not a lead (A-289). */
  | { kind: "gmailConfirmation"; externalId: string; notice: string }
  /** An email no person wrote to the gym: an auto-reply, a bounce, a mailing list (A-290). */
  | { kind: "automatic"; externalId: string; reason: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string, max: number) => value.replace(CONTROL, "").trim().slice(0, max);

/** Text out of an HTML email: tags, scripts and styles removed, entities for the common characters read, blank lines folded. */
export function textFromHtml(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|tr|h[1-6])>/gi, "\n")
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&amp;/gi, "&")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/**
 * The first Vietnamese phone number written in the text (A-291), in the gym's form: `0909 123 456`, `0909.123.456` and
 * `+84 909 123 456` are all `0909123456`. Only a mobile or landline shape is taken (10 digits after the 0), never any number.
 */
export function phoneInText(text: string): string | null {
  const match = /(?<![\d+])(?:\+?84|0)(?:[\s.-]?\d){9}(?!\d)/.exec(text);
  if (!match) return null;
  const digits = match[0].replace(/\D/g, "");
  return digits.startsWith("84") ? `0${digits.slice(2)}` : digits;
}

const header = (headers: { Name: string; Value: string }[], name: string) =>
  headers.find((candidate) => candidate.Name.toLowerCase() === name.toLowerCase())?.Value ?? "";

const EMAIL = z.email();

/** What an inbound email is (A-288 to A-291); null when the body is not an inbound email at all. */
export function readInboundEmail(payload: unknown): InboundEmail | null {
  const parsed = inboundEmailSchema.safeParse(payload);
  if (!parsed.success) return null;
  const mail = parsed.data;
  const externalId = mail.MessageID;
  const from = mail.FromFull.Email.trim().toLowerCase();
  const headers = mail.Headers ?? [];
  const subject = clean(mail.Subject ?? "", 300);

  if (from === GMAIL_FORWARDING) {
    return { kind: "gmailConfirmation", externalId, notice: clean(`${subject}\n\n${mail.TextBody ?? ""}`, 1000) };
  }
  const autoSubmitted = header(headers, "Auto-Submitted").toLowerCase();
  const precedence = header(headers, "Precedence").toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return { kind: "automatic", externalId, reason: "auto-submitted" };
  if (["bulk", "junk", "list", "auto_reply"].includes(precedence))
    return { kind: "automatic", externalId, reason: precedence };
  if (header(headers, "List-Id") || header(headers, "List-Unsubscribe"))
    return { kind: "automatic", externalId, reason: "list" };
  if (/^(mailer-daemon|postmaster|no-?reply)@/.test(from))
    return { kind: "automatic", externalId, reason: "system sender" };
  if (!EMAIL.safeParse(from).success) return { kind: "automatic", externalId, reason: "no sender" };

  const said = mail.StrippedTextReply?.trim() || mail.TextBody?.trim() || textFromHtml(mail.HtmlBody ?? "");
  const files = (mail.Attachments ?? []).map((file) => `[${clean(file.Name ?? "file", 100)}]`);
  const body = clean([subject, said, files.join(" ")].filter(Boolean).join("\n\n"), MAX_MESSAGE_LENGTH);
  const name = clean(mail.FromFull.Name ?? "", 150) || from.split("@")[0]!.slice(0, 150);
  const date = mail.Date ? new Date(mail.Date) : null;
  return {
    kind: "message",
    externalId,
    email: from,
    name,
    phone: phoneInText(`${subject}\n${said}`),
    body,
    receivedAt: date && !Number.isNaN(date.getTime()) ? date : null,
  };
}
