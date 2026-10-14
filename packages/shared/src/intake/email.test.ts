import { describe, expect, it } from "vitest";
import { phoneInText, readInboundEmail, textFromHtml, type InboundEmailBody } from "./index.js";

const mail = (patch: Partial<InboundEmailBody> = {}): InboundEmailBody => ({
  MessageID: "a8c1040e-0001",
  FromFull: { Email: "An.Nguyen@Example.com", Name: "Nguyễn Văn An" },
  Subject: "Hỏi giá gói PT",
  TextBody: "Chào Flow, mình muốn tập PT buổi tối. SĐT: 0909 123 456",
  Date: "Sun, 8 Nov 2026 10:00:00 +0700",
  Headers: [],
  ...patch,
});

describe("an email a person wrote (A-288)", () => {
  it("gives the sender, the name, the phone in the text, the subject and text as the body, and the time", () => {
    expect(readInboundEmail(mail())).toEqual({
      kind: "message",
      externalId: "a8c1040e-0001",
      email: "an.nguyen@example.com",
      name: "Nguyễn Văn An",
      phone: "0909123456",
      body: "Hỏi giá gói PT\n\nChào Flow, mình muốn tập PT buổi tối. SĐT: 0909 123 456",
      receivedAt: new Date("2026-11-08T03:00:00Z"),
    });
  });

  it("prefers the reply without the quoted thread, falls back to the HTML as text, and names attachments", () => {
    const reply = readInboundEmail(mail({ StrippedTextReply: "Ok mình đăng ký", TextBody: "Ok\n> quoted" }));
    expect(reply).toMatchObject({ body: "Hỏi giá gói PT\n\nOk mình đăng ký" });
    const html = readInboundEmail(
      mail({ TextBody: undefined, HtmlBody: "<p>Xin chào</p><script>alert(1)</script><p>Giá &amp; lịch?</p>" }),
    );
    expect(html).toMatchObject({ body: "Hỏi giá gói PT\n\nXin chào\nGiá & lịch?" });
    const files = readInboundEmail(mail({ Attachments: [{ Name: "inbody.pdf" }] }));
    expect(files).toMatchObject({ body: expect.stringContaining("[inbody.pdf]") });
  });

  it("uses the address when there is no name, and has no phone when none is written", () => {
    expect(readInboundEmail(mail({ FromFull: { Email: "binh@example.com" }, TextBody: "Xin chào" }))).toMatchObject({
      name: "binh",
      phone: null,
    });
  });

  it("keeps a script as text, removes control characters and caps the length", () => {
    expect(readInboundEmail(mail({ Subject: "<script>x</script>", TextBody: "a\u0007b" }))).toMatchObject({
      body: "<script>x</script>\n\nab",
    });
    const long = readInboundEmail(mail({ TextBody: "x".repeat(5000) }));
    expect(long?.kind === "message" && long.body.length).toBe(4000);
  });
});

describe("emails that are not a person writing (A-289, A-290)", () => {
  it("recognises Gmail's confirmation of the forwarding rule, with its text for Admin", () => {
    const confirmation = readInboundEmail(
      mail({
        FromFull: { Email: "forwarding-noreply@google.com", Name: "Gmail Team" },
        Subject: "(#123456789) Gmail Forwarding Confirmation",
        TextBody: "Confirmation code: 123456789",
      }),
    );
    expect(confirmation).toEqual({
      kind: "gmailConfirmation",
      externalId: "a8c1040e-0001",
      notice: "(#123456789) Gmail Forwarding Confirmation\n\nConfirmation code: 123456789",
    });
  });

  it("recognises auto-replies, bulk mail, mailing lists and system senders", () => {
    const reason = (patch: Partial<InboundEmailBody>) => {
      const read = readInboundEmail(mail(patch));
      return read?.kind === "automatic" ? read.reason : read?.kind;
    };
    expect(reason({ Headers: [{ Name: "Auto-Submitted", Value: "auto-replied" }] })).toBe("auto-submitted");
    expect(reason({ Headers: [{ Name: "auto-submitted", Value: "no" }] })).toBe("message");
    expect(reason({ Headers: [{ Name: "Precedence", Value: "bulk" }] })).toBe("bulk");
    expect(reason({ Headers: [{ Name: "List-Unsubscribe", Value: "<mailto:x@y>" }] })).toBe("list");
    expect(reason({ FromFull: { Email: "MAILER-DAEMON@example.com" } })).toBe("system sender");
    expect(reason({ FromFull: { Email: "noreply@shop.vn" } })).toBe("system sender");
    expect(reason({ FromFull: { Email: "not an address" } })).toBe("no sender");
  });

  it("is not an email at all without an id or a sender", () => {
    expect(readInboundEmail({})).toBeNull();
    expect(readInboundEmail({ MessageID: "x" })).toBeNull();
    expect(readInboundEmail(null)).toBeNull();
  });
});

describe("a phone in the text (A-291)", () => {
  it("reads the common ways of writing a Vietnamese number", () => {
    for (const text of [
      "0909123456",
      "0909 123 456",
      "0909.123.456",
      "0909-123-456",
      "+84 909 123 456",
      "84909123456",
    ]) {
      expect(phoneInText(`gọi ${text} nhé`), text).toBe("0909123456");
    }
  });

  it("does not take a longer or shorter number, an order number or a price", () => {
    expect(phoneInText("đơn 123456789012345")).toBeNull();
    expect(phoneInText("giá 1.500.000đ")).toBeNull();
    expect(phoneInText("090912345")).toBeNull();
    expect(phoneInText("09091234567")).toBeNull();
  });
});

describe("HTML as text", () => {
  it("drops tags, scripts and styles and keeps the lines", () => {
    expect(textFromHtml("<style>p{}</style><div>Một</div><div>Hai<br>Ba</div>")).toBe("Một\nHai\nBa");
  });
});
