import { describe, expect, it } from "vitest";
import { readZaloEvent, zaloLeadName } from "./index.js";

// The examples are those of developers.zalo.me (Webhook → Tin nhắn, Quản lý), with the app id and times of the tests.
const base = {
  app_id: "360846524940903967",
  sender: { id: "246845883529197922" },
  user_id_by_app: "552177279717587730",
  recipient: { id: "388613280878808645" },
  timestamp: "1767000000000",
};
const message = (event_name: string, message: Record<string, unknown>) => ({ ...base, event_name, message });

describe("a message a user sends to the OA (A-295)", () => {
  it("reads a text with the message id, the sender, a name made from the sender and the time", () => {
    expect(
      readZaloEvent(message("user_send_text", { text: "Cho mình hỏi giá PT", msg_id: "96d3cdf3af150460909" })),
    ).toEqual({
      kind: "message",
      appId: "360846524940903967",
      externalId: "96d3cdf3af150460909",
      senderRef: "246845883529197922",
      name: "Zalo 197922",
      phone: null,
      body: "Cho mình hỏi giá PT",
      receivedAt: new Date(1767000000000),
    });
  });

  it("names attachments by their kind, a file by its name, a link by its address", () => {
    const body = (event: string, attachments: unknown[], text?: string) => {
      const read = readZaloEvent(message(event, { msg_id: "m", attachments, ...(text ? { text } : {}) }));
      return read.kind === "message" ? read.body : read.kind;
    };
    expect(
      body("user_send_image", [{ type: "image", payload: { url: "http://f6.photo.talk.zdn.vn/x.jpg" } }], "Đây ạ"),
    ).toBe("Đây ạ [image]");
    expect(body("user_send_file", [{ type: "file", payload: { name: "developer.docx", url: "https://x" } }])).toBe(
      "[file: developer.docx]",
    );
    expect(body("user_send_link", [{ type: "link", payload: { url: "https://developers.zalo.me/" } }])).toBe(
      "[link] https://developers.zalo.me/",
    );
    expect(body("user_send_location", [{ type: "location", payload: {} }])).toBe("[location]");
    expect(body("user_send_sticker", [])).toBe("[sticker]");
  });

  it("strips control characters and caps the length", () => {
    const read = readZaloEvent(message("user_send_text", { msg_id: "m", text: `a\u0007b${"x".repeat(5000)}` }));
    expect(read.kind === "message" && read.body.startsWith("ab")).toBe(true);
    expect(read.kind === "message" && read.body.length).toBe(4000);
  });
});

describe("the information a user agrees to share (A-297)", () => {
  it("gives the name, the phone in the gym's form and the address", () => {
    const read = readZaloEvent({
      ...base,
      event_name: "user_submit_info",
      info: {
        name: "Name Example",
        phone: "84912345678",
        full_address: {
          user_city: "Thành phố Hồ Chí Minh",
          user_ward: "Phường Tân Thuận",
          user_address: "Đường số 13",
        },
      },
    });
    expect(read).toEqual({
      kind: "info",
      appId: "360846524940903967",
      externalId: "info:246845883529197922:1767000000000",
      senderRef: "246845883529197922",
      name: "Name Example",
      phone: "0912345678",
      body: "Name Example\n0912345678\nĐường số 13, Phường Tân Thuận, Thành phố Hồ Chí Minh",
      receivedAt: new Date(1767000000000),
    });
  });
});

describe("events that are not a user writing (A-295)", () => {
  it("are ignored, with the app id when there is one", () => {
    expect(readZaloEvent({ ...base, event_name: "follow", follower: { id: "1" } })).toEqual({
      kind: "ignored",
      appId: "360846524940903967",
      reason: "follow",
    });
    expect(readZaloEvent({ ...base, event_name: "oa_send_text", message: { msg_id: "m", text: "x" } })).toMatchObject({
      kind: "ignored",
      reason: "oa_send_text",
    });
    expect(readZaloEvent({ ...base, event_name: "user_send_text" })).toMatchObject({ kind: "ignored" });
    expect(readZaloEvent(null)).toEqual({ kind: "ignored", appId: null, reason: "unreadable" });
    expect(readZaloEvent({ event_name: "user_send_text" })).toMatchObject({ kind: "ignored", reason: "unreadable" });
  });

  it("names a lead by the end of the user id", () => {
    expect(zaloLeadName("246845883529197922")).toBe("Zalo 197922");
  });
});
