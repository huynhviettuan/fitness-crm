import { describe, expect, it } from "vitest";
import {
  AVAILABLE_INTAKE_KINDS,
  intakeSourceInputSchema,
  parseWhatsAppPayload,
  phoneFromWhatsApp,
  whatsAppHandshakeSchema,
} from "./index.js";

const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";

function payload(messages: unknown[], contacts: unknown[] = [{ wa_id: "84909123456", profile: { name: "An" } }]) {
  return {
    object: "whatsapp_business_account",
    entry: [{ id: "1", changes: [{ field: "messages", value: { contacts, messages } }] }],
  };
}
const text = (patch: Record<string, unknown> = {}) => ({
  from: "84909123456",
  id: "wamid.1",
  timestamp: "1767000000",
  type: "text",
  text: { body: "Tôi muốn tập thử" },
  ...patch,
});

describe("a WhatsApp number as the gym stores it (A-269)", () => {
  it("turns the Vietnamese country code into the leading zero, so a returning customer matches", () => {
    expect(phoneFromWhatsApp("84909123456")).toBe("0909123456");
    expect(phoneFromWhatsApp("+84 909 123 456")).toBe("0909123456");
    expect(phoneFromWhatsApp("841234567890")).toBe("01234567890");
  });

  it("keeps a foreign number with its plus, and refuses what is not a number", () => {
    expect(phoneFromWhatsApp("14155550123")).toBe("+14155550123");
    expect(phoneFromWhatsApp("abc")).toBeNull();
    expect(phoneFromWhatsApp("123")).toBeNull();
    expect(phoneFromWhatsApp("1".repeat(16))).toBeNull();
  });
});

describe("reading what Meta posts (A-270)", () => {
  it("reads a text message with the profile name, the id and the time", () => {
    expect(parseWhatsAppPayload(payload([text()]))).toEqual([
      {
        externalId: "wamid.1",
        phone: "0909123456",
        name: "An",
        body: "Tôi muốn tập thử",
        receivedAt: new Date(1767000000 * 1000),
      },
    ]);
  });

  it("uses the phone as the name when WhatsApp gives none, and the matching contact when there are several", () => {
    expect(parseWhatsAppPayload(payload([text()], []))[0]?.name).toBe("0909123456");
    const contacts = [
      { wa_id: "84911111111", profile: { name: "Khác" } },
      { wa_id: "84909123456", profile: { name: "An" } },
    ];
    expect(parseWhatsAppPayload(payload([text()], contacts))[0]?.name).toBe("An");
  });

  it("keeps what a button or a list choice said, and names what has no text", () => {
    const body = (message: Record<string, unknown>) => parseWhatsAppPayload(payload([text(message)]))[0]?.body;
    expect(body({ type: "button", text: undefined, button: { text: "Đặt lịch" } })).toBe("Đặt lịch");
    expect(body({ type: "interactive", text: undefined, interactive: { list_reply: { title: "Gói PT" } } })).toBe(
      "Gói PT",
    );
    expect(body({ type: "image", text: undefined, image: { caption: "Đây ạ" } })).toBe("Đây ạ [image]");
    expect(body({ type: "audio", text: undefined })).toBe("[audio]");
  });

  it("gives nothing for delivery statuses, other fields, empty or unknown bodies", () => {
    expect(
      parseWhatsAppPayload({ entry: [{ changes: [{ value: { statuses: [{ id: "x", status: "read" }] } }] }] }),
    ).toEqual([]);
    expect(parseWhatsAppPayload({})).toEqual([]);
    expect(parseWhatsAppPayload(null)).toEqual([]);
    expect(parseWhatsAppPayload("text")).toEqual([]);
    expect(parseWhatsAppPayload({ entry: "x" })).toEqual([]);
  });

  it("skips a message with no id or no usable number, and keeps the others of the same delivery", () => {
    const found = parseWhatsAppPayload(payload([{ type: "text" }, text({ from: "12" }), text({ id: "wamid.2" })]));
    expect(found.map((message) => message.externalId)).toEqual(["wamid.2"]);
  });

  it("strips control characters, keeps line breaks, and caps the length", () => {
    const [message] = parseWhatsAppPayload(payload([text({ text: { body: "một\nhai\u0007ba" } })]));
    expect(message?.body).toBe("một\nhaiba");
    const [long] = parseWhatsAppPayload(payload([text({ text: { body: "x".repeat(5000) } })]));
    expect(long?.body).toHaveLength(4000);
  });

  it("ignores a time that is not a time", () => {
    expect(parseWhatsAppPayload(payload([text({ timestamp: "soon" })]))[0]?.receivedAt).toBeNull();
  });
});

describe("the handshake and the source (A-268, A-271)", () => {
  it("accepts Meta's query and refuses a challenge that could be a script", () => {
    const ok = { "hub.mode": "subscribe", "hub.verify_token": "t", "hub.challenge": "158772" };
    expect(whatsAppHandshakeSchema.safeParse(ok).success).toBe(true);
    expect(whatsAppHandshakeSchema.safeParse({ ...ok, "hub.mode": "unsubscribe" }).success).toBe(false);
    expect(whatsAppHandshakeSchema.safeParse({ ...ok, "hub.challenge": "<script>" }).success).toBe(false);
    expect(whatsAppHandshakeSchema.safeParse({ ...ok, "hub.verify_token": undefined }).success).toBe(false);
  });

  it("registers a WhatsApp source only with the app secret, and a website one never with it", () => {
    const base = { name: "WhatsApp", channelId: id };
    const secret = "a".repeat(32);
    expect(AVAILABLE_INTAKE_KINDS).toEqual(["WEBSITE", "WHATSAPP", "MESSENGER", "INSTAGRAM"]);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WHATSAPP", appSecret: secret }).success).toBe(true);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WHATSAPP" }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WHATSAPP", appSecret: "short" }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WHATSAPP", appSecret: `${secret}!\n` }).success).toBe(
      false,
    );
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WEBSITE", appSecret: secret }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "WEBSITE" }).success).toBe(true);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "MESSENGER", appSecret: secret }).success).toBe(true);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "INSTAGRAM" }).success).toBe(false);
    expect(intakeSourceInputSchema.safeParse({ ...base, kind: "ZALO", appSecret: secret }).success).toBe(false);
  });
});
