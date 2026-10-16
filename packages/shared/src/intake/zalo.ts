import { z } from "zod";
import { phoneFromWhatsApp } from "./whatsapp.js";

// Zalo Official Account, receive only (M10.6; brief §11, D-036, D-044; A-294 to A-300). Zalo posts each event of the gym's OA to the
// webhook, signed with `X-ZEvent-Signature: mac = sha256(appId + data + timeStamp + OAsecretKey)` (developers.zalo.me, Webhook →
// Tin nhắn). Read here, purely: the messages a user sends, and the name and phone a user agrees to share (`user_submit_info`).

/** The same cap as every message (`MAX_MESSAGE_LENGTH` in the domain). */
const MAX_MESSAGE_LENGTH = 4000;

/** The events of a user writing to the OA; every other event (follows, clicks, our own messages) is not taken in. */
export const ZALO_MESSAGE_EVENTS = [
  "user_send_text",
  "user_send_image",
  "user_send_gif",
  "user_send_link",
  "user_send_audio",
  "user_send_video",
  "user_send_sticker",
  "user_send_location",
  "user_send_business_card",
  "user_send_file",
] as const;

/** A Zalo app id: digits. */
export const ZALO_APP_ID_PATTERN = /^\d{5,30}$/;

const attachmentSchema = z.object({
  type: z.string().max(40).optional(),
  payload: z.object({ name: z.string().max(300).optional(), url: z.string().max(2000).optional() }).optional(),
});

const eventSchema = z.object({
  app_id: z.string().max(40),
  event_name: z.string().max(80),
  timestamp: z.union([z.string(), z.number()]).transform(String),
  sender: z.object({ id: z.string().min(1).max(100) }),
  message: z
    .object({
      msg_id: z.string().min(1).max(200),
      text: z.string().optional(),
      attachments: z.array(attachmentSchema).optional(),
    })
    .optional(),
  info: z
    .object({
      name: z.string().max(300).optional(),
      phone: z.string().max(40).optional(),
      full_address: z
        .object({
          user_address: z.string().max(500).optional(),
          user_ward: z.string().max(200).optional(),
          user_district: z.string().max(200).optional(),
          user_city: z.string().max(200).optional(),
        })
        .optional(),
    })
    .optional(),
});

export type ZaloEvent =
  | {
      kind: "message" | "info";
      appId: string;
      /** The message id, or for shared information one made from the sender and the time (a retry repeats both). */
      externalId: string;
      /** The user's id for this OA: what ties a person's messages together. */
      senderRef: string;
      name: string;
      phone: string | null;
      body: string;
      receivedAt: Date | null;
    }
  | { kind: "ignored"; appId: string | null; reason: string };

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const clean = (value: string, max: number) => value.replace(CONTROL, "").trim().slice(0, max);

/** The name of a lead made from a Zalo message: the channel and the end of the user's id (A-296). */
export function zaloLeadName(senderRef: string): string {
  return `Zalo ${senderRef.slice(-6)}`;
}

function attachmentText(attachment: z.infer<typeof attachmentSchema>): string {
  const type = clean(attachment.type ?? "file", 40);
  if (type === "file" && attachment.payload?.name) return `[file: ${clean(attachment.payload.name, 200)}]`;
  if (type === "link" && attachment.payload?.url) return `[link] ${clean(attachment.payload.url, 500)}`;
  return `[${type}]`;
}

/** What a webhook body is (A-295, A-297). */
export function readZaloEvent(payload: unknown): ZaloEvent {
  const parsed = eventSchema.safeParse(payload);
  if (!parsed.success) {
    const appId = (payload as { app_id?: unknown } | null)?.app_id;
    return { kind: "ignored", appId: typeof appId === "string" ? appId : null, reason: "unreadable" };
  }
  const event = parsed.data;
  const millis = Number(event.timestamp);
  const receivedAt = Number.isFinite(millis) && millis > 0 ? new Date(millis) : null;
  const senderRef = event.sender.id;

  if ((ZALO_MESSAGE_EVENTS as readonly string[]).includes(event.event_name) && event.message) {
    const said = [event.message.text ?? "", ...(event.message.attachments ?? []).map(attachmentText)]
      .filter(Boolean)
      .join(" ");
    const kind = event.event_name.replace("user_send_", "");
    return {
      kind: "message",
      appId: event.app_id,
      externalId: event.message.msg_id,
      senderRef,
      name: zaloLeadName(senderRef),
      phone: null,
      body: clean(said || `[${kind}]`, MAX_MESSAGE_LENGTH),
      receivedAt,
    };
  }
  if (event.event_name === "user_submit_info" && event.info) {
    const info = event.info;
    const phone = info.phone ? phoneFromWhatsApp(info.phone) : null;
    const address = info.full_address;
    const place = [address?.user_address, address?.user_ward, address?.user_district, address?.user_city]
      .map((part) => clean(part ?? "", 200))
      .filter(Boolean)
      .join(", ");
    const name = clean(info.name ?? "", 150);
    return {
      kind: "info",
      appId: event.app_id,
      externalId: `info:${senderRef}:${event.timestamp}`,
      senderRef,
      name: name || zaloLeadName(senderRef),
      phone,
      body: clean([name, phone, place].filter(Boolean).join("\n"), MAX_MESSAGE_LENGTH),
      receivedAt,
    };
  }
  return { kind: "ignored", appId: event.app_id, reason: event.event_name };
}
