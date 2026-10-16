import { describe, expect, it } from "vitest";
import { messagingLeadName, parseMessagingPayload } from "./index.js";

const page = (messaging: unknown[], object = "page") => ({ object, entry: [{ id: "PAGE", time: 1, messaging }] });
const event = (patch: Record<string, unknown> = {}, message: Record<string, unknown> = {}) => ({
  sender: { id: "6543210987654321" },
  recipient: { id: "PAGE" },
  timestamp: 1767000000000,
  message: { mid: "m_1", text: "Cho mình hỏi giá PT", ...message },
  ...patch,
});

describe("reading what Messenger and Instagram post (A-276)", () => {
  it("reads a text with the sender id, a name made from it, the id and the time", () => {
    expect(parseMessagingPayload("MESSENGER", page([event()]))).toEqual([
      {
        externalId: "m_1",
        senderRef: "6543210987654321",
        name: "Messenger 654321",
        body: "Cho mình hỏi giá PT",
        receivedAt: new Date(1767000000000),
      },
    ]);
    expect(parseMessagingPayload("INSTAGRAM", page([event()], "instagram"))[0]?.name).toBe("Instagram 654321");
  });

  it("skips our own replies, deleted messages, and events that are not messages", () => {
    expect(parseMessagingPayload("MESSENGER", page([event({}, { is_echo: true })]))).toEqual([]);
    expect(parseMessagingPayload("MESSENGER", page([event({}, { is_deleted: true })]))).toEqual([]);
    const read = { sender: { id: "1" }, recipient: { id: "PAGE" }, read: { watermark: 1 } };
    const reaction = { sender: { id: "1" }, recipient: { id: "PAGE" }, reaction: { mid: "m", action: "react" } };
    expect(parseMessagingPayload("MESSENGER", page([read, reaction]))).toEqual([]);
  });

  it("keeps a button's title, and names attachments by their kind", () => {
    const postback = { sender: { id: "1234567" }, postback: { mid: "m_p", title: "Đặt lịch tập thử" } };
    expect(parseMessagingPayload("MESSENGER", page([postback]))[0]?.body).toBe("Đặt lịch tập thử");
    const picture = event({}, { mid: "m_2", text: undefined, attachments: [{ type: "image" }, { type: "audio" }] });
    expect(parseMessagingPayload("MESSENGER", page([picture]))[0]?.body).toBe("[image] [audio]");
  });

  it("refuses the other product's body, and gives nothing for bodies it cannot read", () => {
    expect(parseMessagingPayload("INSTAGRAM", page([event()], "page"))).toEqual([]);
    expect(parseMessagingPayload("MESSENGER", page([event()], "instagram"))).toEqual([]);
    expect(parseMessagingPayload("MESSENGER", page([event()], "whatsapp_business_account"))).toEqual([]);
    for (const body of [null, "x", {}, { entry: "x" }, { entry: [{ messaging: "x" }] }]) {
      expect(parseMessagingPayload("MESSENGER", body)).toEqual([]);
    }
  });

  it("skips an event without a message id or a sender, and keeps the others of the delivery", () => {
    const found = parseMessagingPayload(
      "MESSENGER",
      page([
        { sender: { id: "1" }, message: { text: "no id" } },
        { message: { mid: "m_x" } },
        event({}, { mid: "m_ok" }),
      ]),
    );
    expect(found.map((message) => message.externalId)).toEqual(["m_ok"]);
  });

  it("strips control characters, keeps line breaks, and caps the length", () => {
    expect(parseMessagingPayload("MESSENGER", page([event({}, { text: "một\nhai\u0007" })]))[0]?.body).toBe("một\nhai");
    expect(parseMessagingPayload("MESSENGER", page([event({}, { text: "x".repeat(5000) })]))[0]?.body).toHaveLength(
      4000,
    );
  });

  it("names a lead by its channel and the end of the sender id", () => {
    expect(messagingLeadName("MESSENGER", "12")).toBe("Messenger 12");
    expect(messagingLeadName("INSTAGRAM", "17841400000000123")).toBe("Instagram 000123");
  });
});
