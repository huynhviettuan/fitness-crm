import { z } from "zod";

// Messenger and Instagram webhooks (M10.3; brief §11, D-044; A-275 to A-280): what Meta posts when someone writes to the gym's
// Facebook page or Instagram account, read into plain messages. Both use `entry[].messaging[]` with a sender id that belongs to the
// page (PSID) or the account (IGSID): there is no phone and no name, so the sender id is what ties a person's messages together.
// Pure and lenient like the WhatsApp reader: anything not understood is skipped, never an error.

/** The same cap as every message (`MAX_MESSAGE_LENGTH` in the domain). */
const MAX_MESSAGE_LENGTH = 4000;

export const MESSAGING_KINDS = ["MESSENGER", "INSTAGRAM"] as const;
export type MessagingKind = (typeof MESSAGING_KINDS)[number];

const eventSchema = z.object({
  sender: z.object({ id: z.string().min(1).max(100) }),
  timestamp: z.number().optional(),
  message: z
    .object({
      mid: z.string().min(1).max(300),
      text: z.string().optional(),
      is_echo: z.boolean().optional(),
      is_deleted: z.boolean().optional(),
      quick_reply: z.object({ payload: z.string().optional() }).optional(),
      attachments: z.array(z.object({ type: z.string().max(40).optional() })).optional(),
    })
    .optional(),
  postback: z.object({ mid: z.string().min(1).max(300).optional(), title: z.string().optional() }).optional(),
});

const payloadSchema = z.object({
  object: z.string().optional(),
  entry: z.array(z.object({ messaging: z.array(z.unknown()).optional() })).optional(),
});

/** One message a person sent to the page or the account. */
export type MessagingMessage = {
  /** Meta's id of the message (`mid`), unique, so a retried delivery is recognised. */
  externalId: string;
  /** The sender's id for this page or account: the only thing that says two messages are from one person. */
  senderRef: string;
  /** A name to start the lead with; the consultant replaces it once they know the person (A-277). */
  name: string;
  body: string;
  receivedAt: Date | null;
};

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string, max: number) => value.replace(CONTROL, "").trim().slice(0, max);

const KIND_LABEL: Record<MessagingKind, string> = { MESSENGER: "Messenger", INSTAGRAM: "Instagram" };

/** The name of a lead made from a message: the channel and the end of the sender's id, so two leads can be told apart. */
export function messagingLeadName(kind: MessagingKind, senderRef: string): string {
  return `${KIND_LABEL[kind]} ${senderRef.slice(-6)}`;
}

/**
 * The messages people sent in a webhook body. Our own replies (echoes), deleted messages, reads, deliveries, reactions and shapes we
 * do not understand give none. A body for the other product (a page body sent to an Instagram source) gives none either.
 */
export function parseMessagingPayload(kind: MessagingKind, payload: unknown): MessagingMessage[] {
  const parsed = payloadSchema.safeParse(payload);
  if (!parsed.success) return [];
  const expected = kind === "MESSENGER" ? "page" : "instagram";
  if (parsed.data.object !== undefined && parsed.data.object !== expected) return [];
  const found: MessagingMessage[] = [];
  for (const entry of parsed.data.entry ?? []) {
    for (const raw of entry.messaging ?? []) {
      const event = eventSchema.safeParse(raw);
      if (!event.success) continue;
      const { sender, message, postback, timestamp } = event.data;
      if (message?.is_echo || message?.is_deleted) continue;
      const externalId = message?.mid ?? postback?.mid;
      if (!externalId) continue;
      const kinds = (message?.attachments ?? []).map((attachment) => `[${clean(attachment.type ?? "file", 40)}]`);
      const said = message?.text ?? postback?.title ?? "";
      const senderRef = sender.id;
      found.push({
        externalId,
        senderRef,
        name: messagingLeadName(kind, senderRef),
        body: clean([said, ...kinds].filter(Boolean).join(" "), MAX_MESSAGE_LENGTH),
        receivedAt: timestamp && timestamp > 0 ? new Date(timestamp) : null,
      });
    }
  }
  return found;
}
