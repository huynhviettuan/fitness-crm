import { z } from "zod";

/** The same cap as every message (`MAX_MESSAGE_LENGTH` in the domain, which imports this file). */
const MAX_MESSAGE_LENGTH = 4000;

// WhatsApp Business Cloud API webhooks (M10.2; brief §11, D-044; A-268 to A-274): what Meta posts when a customer writes to the
// gym's number, read into plain messages. Pure and lenient: anything not understood is skipped, never an error, so Meta is
// answered 200 and does not keep retrying a payload we could never use.

/** A WhatsApp number (`wa_id`, digits with the country code) in the form the gym stores: 84909123456 becomes 0909123456. */
export function phoneFromWhatsApp(waId: string): string | null {
  const digits = waId.replace(/\D/g, "");
  if (digits.length < 8 || digits.length > 15) return null;
  if (digits.startsWith("84") && (digits.length === 11 || digits.length === 12)) return `0${digits.slice(2)}`;
  return `+${digits}`;
}

const text = z.object({ body: z.string().optional() }).optional();
const reply = z.object({ title: z.string().optional() }).optional();

const messageSchema = z.object({
  id: z.string().min(1).max(200),
  from: z.string().min(1).max(40),
  timestamp: z.string().optional(),
  type: z.string().max(40).optional(),
  text,
  button: z.object({ text: z.string().optional() }).optional(),
  interactive: z.object({ button_reply: reply, list_reply: reply }).optional(),
  image: z.object({ caption: z.string().optional() }).optional(),
  video: z.object({ caption: z.string().optional() }).optional(),
  document: z.object({ caption: z.string().optional() }).optional(),
});

const payloadSchema = z.object({
  entry: z
    .array(
      z.object({
        changes: z
          .array(
            z.object({
              value: z
                .object({
                  contacts: z
                    .array(
                      z.object({
                        wa_id: z.string().optional(),
                        profile: z.object({ name: z.string().optional() }).optional(),
                      }),
                    )
                    .optional(),
                  messages: z.array(z.unknown()).optional(),
                })
                .optional(),
            }),
          )
          .optional(),
      }),
    )
    .optional(),
});

/** One message a customer sent. */
export type WhatsAppMessage = {
  /** Meta's id of the message (`wamid…`), unique, so a retried delivery is recognised. */
  externalId: string;
  /** The customer's phone as the gym stores it. */
  phone: string;
  name: string;
  body: string;
  receivedAt: Date | null;
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string, max: number) => value.replace(CONTROL, "").trim().slice(0, max);

function bodyOf(message: z.infer<typeof messageSchema>): string {
  const caption = message.image?.caption ?? message.video?.caption ?? message.document?.caption;
  const said =
    message.text?.body ??
    message.button?.text ??
    message.interactive?.button_reply?.title ??
    message.interactive?.list_reply?.title ??
    caption ??
    "";
  const kind = message.type ?? "unknown";
  // A picture, voice note or location has no text we can keep; its kind says what was sent.
  const placeholder = message.text || ["text", "button", "interactive"].includes(kind) ? "" : `[${clean(kind, 40)}]`;
  return clean([said, placeholder].filter(Boolean).join(" "), MAX_MESSAGE_LENGTH);
}

/** The customer messages in a webhook body (delivery statuses and unknown shapes give none). */
export function parseWhatsAppPayload(payload: unknown): WhatsAppMessage[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const found: WhatsAppMessage[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value;
      for (const raw of value?.messages ?? []) {
        const message = messageSchema.safeParse(raw);
        if (!message.success) continue;
        const phone = phoneFromWhatsApp(message.data.from);
        if (!phone) continue;
        const contact =
          value?.contacts?.find((candidate) => candidate.wa_id === message.data.from) ?? value?.contacts?.[0];
        const seconds = Number(message.data.timestamp);
        found.push({
          externalId: message.data.id,
          phone,
          name: clean(contact?.profile?.name ?? "", 150) || phone,
          body: bodyOf(message.data),
          receivedAt: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : null,
        });
      }
    }
  }
  return found;
}

/** Meta's webhook handshake: `hub.mode`, `hub.verify_token`, `hub.challenge` in the query. The challenge is echoed, so it is kept plain. */
export const whatsAppHandshakeSchema = z.object({
  "hub.mode": z.literal("subscribe"),
  "hub.verify_token": z.string().min(1).max(200),
  "hub.challenge": z.string().regex(/^[A-Za-z0-9_-]{1,100}$/),
});

/** What WhatsApp is told: how many messages were taken in and how many were repeats. */
export const whatsAppReceiptSchema = z
  .object({ received: z.int(), duplicates: z.int() })
  .meta({ id: "WhatsAppReceipt" });
export type WhatsAppReceipt = z.output<typeof whatsAppReceiptSchema>;

/** The app secret Admin pastes from Meta: long enough to be one, and nothing that could break a header or a log. */
export const whatsAppSecretSchema = z
  .string()
  .trim()
  .min(16, { error: "tooShort" })
  .max(200, { error: "tooLong" })
  .regex(/^[A-Za-z0-9]+$/, { error: "invalidCharacters" });
