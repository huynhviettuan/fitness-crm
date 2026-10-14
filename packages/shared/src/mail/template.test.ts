import { describe, expect, it } from "vitest";
import {
  EMAIL_EVENT_KEYS,
  EMAIL_EVENTS,
  EMAIL_TEMPLATE_DEFAULTS,
  emailLocaleFor,
  emailTemplateInputSchema,
  placeholdersIn,
  renderTemplate,
  sampleValues,
  templateProblems,
} from "./index.js";

describe("rendering a template (FR-MAIL-001)", () => {
  it("fills the placeholders and leaves a missing value empty, never a raw brace", () => {
    expect(renderTemplate("Hi {customerName}, {remaining} left. {reason}", { customerName: "An", remaining: 14 })).toBe(
      "Hi An, 14 left. ",
    );
  });

  it("reads the placeholders a text uses", () => {
    expect(placeholdersIn("{a} and {b} and {a} {not a name}")).toEqual(["a", "b", "a"]);
  });
});

describe("the templates the system starts with", () => {
  it.each(EMAIL_EVENT_KEYS)("%s is valid for its event, in both languages", (event) => {
    const template = EMAIL_TEMPLATE_DEFAULTS[event];
    expect(emailTemplateInputSchema.safeParse(template).success).toBe(true);
    expect(templateProblems(event, template)).toEqual({});
    for (const locale of ["vi", "en"] as const) {
      const text = renderTemplate(locale === "vi" ? template.bodyVi : template.bodyEn, sampleValues(locale));
      expect(text).not.toMatch(/[{}]/);
    }
  });

  it("every mandatory event tells the customer the sessions left, and the optional ones are many", () => {
    const mandatory = EMAIL_EVENT_KEYS.filter((event) => EMAIL_EVENTS[event].mandatory);
    expect(mandatory).toHaveLength(5);
    for (const event of mandatory) expect(EMAIL_EVENTS[event].required).toContain("remaining");
    expect(EMAIL_EVENT_KEYS.filter((event) => !EMAIL_EVENTS[event].mandatory)).toHaveLength(8);
  });
});

describe("what a template may say (D-036)", () => {
  const base = EMAIL_TEMPLATE_DEFAULTS["session.credited"];

  it("refuses a placeholder the event does not offer, and a body that drops what must be told", () => {
    expect(templateProblems("session.credited", { ...base, bodyVi: "Chào {customerName}, {className}" })).toEqual({
      bodyVi: ["unknownPlaceholder", "missingPlaceholder"],
    });
    expect(templateProblems("session.credited", { ...base, subjectEn: "{remaining} {nope}" })).toEqual({
      subjectEn: ["unknownPlaceholder"],
    });
    // The refund must give the reason.
    expect(
      templateProblems("session.refunded", {
        ...EMAIL_TEMPLATE_DEFAULTS["session.refunded"],
        bodyEn: "Left: {remaining}",
      }),
    ).toEqual({ bodyEn: ["missingPlaceholder"] });
  });

  it("keeps a line break out of a subject and a control character out of everything", () => {
    expect(emailTemplateInputSchema.safeParse({ ...base, subjectVi: "a\nb" }).success).toBe(false);
    expect(emailTemplateInputSchema.safeParse({ ...base, bodyEn: "a\u0007b" }).success).toBe(false);
    expect(emailTemplateInputSchema.safeParse({ ...base, bodyEn: "line one\nline two" }).success).toBe(true);
    expect(emailTemplateInputSchema.safeParse({ ...base, bodyVi: "  " }).success).toBe(false);
    expect(emailTemplateInputSchema.safeParse({ ...base, subjectVi: "x".repeat(201) }).success).toBe(false);
  });
});

describe("the language of an email (D-036)", () => {
  it("follows the nationality group: foreign customers in English, the rest in Vietnamese", () => {
    expect(emailLocaleFor("VN")).toBe("vi");
    expect(emailLocaleFor("US")).toBe("en");
    expect(emailLocaleFor(null)).toBe("vi");
    expect(emailLocaleFor("")).toBe("vi");
  });
});
