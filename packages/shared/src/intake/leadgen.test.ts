import { describe, expect, it } from "vitest";
import { graphLeadSchema, leadFromForm, pageTokenInputSchema, parseLeadgenPayload, phoneFromForm } from "./index.js";

const change = (value: Record<string, unknown>, field = "leadgen") => ({ field, value });
const page = (changes: unknown[], object = "page") => ({ object, entry: [{ id: "PAGE", time: 1, changes }] });

describe("the leadgen webhook (A-281)", () => {
  it("reads the lead id, the form and the time", () => {
    expect(
      parseLeadgenPayload(page([change({ leadgen_id: "4444555566667777", form_id: 123, created_time: 1767000000 })])),
    ).toEqual([{ leadgenId: "4444555566667777", formId: "123", createdAt: new Date(1767000000 * 1000) }]);
    expect(parseLeadgenPayload(page([change({ leadgen_id: 42 })]))[0]?.leadgenId).toBe("42");
  });

  it("refuses a lead id that is not digits, so nothing but an id reaches the call to Meta", () => {
    for (const leadgen_id of ["../me", "1?fields=x", "1/2", "", "1".repeat(31)]) {
      expect(parseLeadgenPayload(page([change({ leadgen_id })]))).toEqual([]);
    }
  });

  it("gives nothing for other fields, other objects, messages and unreadable bodies", () => {
    expect(parseLeadgenPayload(page([change({ leadgen_id: "1" }, "feed")]))).toEqual([]);
    expect(parseLeadgenPayload(page([change({ leadgen_id: "1" })], "instagram"))).toEqual([]);
    expect(parseLeadgenPayload({ object: "page", entry: [{ messaging: [{ message: { mid: "m" } }] }] })).toEqual([]);
    for (const body of [null, "x", {}, { entry: "x" }, { entry: [{ changes: "x" }] }]) {
      expect(parseLeadgenPayload(body)).toEqual([]);
    }
  });
});

const lead = (fields: [string, string[]][]) =>
  graphLeadSchema.parse({ id: "1", field_data: fields.map(([name, values]) => ({ name, values })) });

describe("Meta's answer for a lead (A-282)", () => {
  it("takes the standard fields and keeps the other questions as lines", () => {
    expect(
      leadFromForm(
        lead([
          ["full_name", ["Nguyễn Văn An"]],
          ["phone_number", ["+84909123456"]],
          ["email", ["An@Example.com"]],
          ["Bạn muốn tập gì?", ["PT 1-1"]],
          ["Khung giờ", ["Tối", "Cuối tuần"]],
        ]),
      ),
    ).toEqual({
      name: "Nguyễn Văn An",
      phone: "0909123456",
      email: "an@example.com",
      answers: "Bạn muốn tập gì?: PT 1-1\nKhung giờ: Tối, Cuối tuần",
    });
  });

  it("joins a first and last name, and leaves out what is missing or not valid", () => {
    expect(
      leadFromForm(
        lead([
          ["first_name", ["An"]],
          ["last_name", ["Nguyễn"]],
        ]),
      ),
    ).toMatchObject({ name: "An Nguyễn" });
    expect(
      leadFromForm(
        lead([
          ["email", ["nope"]],
          ["phone_number", ["12"]],
        ]),
      ),
    ).toEqual({
      name: null,
      phone: null,
      email: null,
      answers: "",
    });
  });

  it("keeps a script and control characters out of nothing but the text: a script stays text, bells go", () => {
    const form = leadFromForm(
      lead([
        ["full_name", ["<b>An</b>\u0007"]],
        ["Ghi chú", ["<script>x</script>"]],
      ]),
    );
    expect(form.name).toBe("<b>An</b>");
    expect(form.answers).toBe("Ghi chú: <script>x</script>");
  });

  it("reads a phone however the form wrote it", () => {
    expect(phoneFromForm("0909 123 456")).toBe("0909123456");
    expect(phoneFromForm("+84 909-123-456")).toBe("0909123456");
    expect(phoneFromForm("+1 415 555 0123")).toBe("+14155550123");
    expect(phoneFromForm("abc")).toBeNull();
  });
});

describe("the Page token (A-283)", () => {
  it("is long and plain, and nothing else is accepted", () => {
    expect(pageTokenInputSchema.safeParse({ pageToken: `EAAB${"x".repeat(100)}` }).success).toBe(true);
    for (const pageToken of ["short", `EAAB${"x".repeat(30)} x`, `EAAB${"x".repeat(30)}\nxx`, "x".repeat(1001)]) {
      expect(pageTokenInputSchema.safeParse({ pageToken }).success).toBe(false);
    }
    expect(pageTokenInputSchema.safeParse({ pageToken: `EAAB${"x".repeat(30)}`, other: 1 }).success).toBe(false);
  });
});
