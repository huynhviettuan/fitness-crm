import { describe, expect, it } from "vitest";
import { z } from "zod";
import { leadNoteInputSchema } from "./note.schema.js";
import { listScriptsQuerySchema, scriptInputSchema, scriptLanguage, scriptOrderSchema } from "./script.schema.js";

const errors = (schema: z.ZodType, input: unknown) => {
  const result = schema.safeParse(input);
  return result.success ? {} : z.flattenError(result.error).fieldErrors;
};

describe("scriptInputSchema (A-072)", () => {
  it("stores empty answers as null and a script as active by default", () => {
    expect(scriptInputSchema.parse({ situationVi: " Giá PT ", situationEn: "PT price" })).toEqual({
      situationVi: "Giá PT",
      situationEn: "PT price",
      answerVi: null,
      answerEn: null,
      active: true,
    });
  });

  it("keeps line breaks in an answer", () => {
    const parsed = scriptInputSchema.parse({
      situationVi: "A",
      situationEn: "A",
      answerVi: "Dòng một\nDòng hai",
    });

    expect(parsed.answerVi).toBe("Dòng một\nDòng hai");
  });

  it("needs both situation names and limits lengths and characters", () => {
    expect(errors(scriptInputSchema, { situationVi: "", situationEn: " " })).toEqual({
      situationVi: ["required"],
      situationEn: ["required"],
    });
    expect(
      errors(scriptInputSchema, {
        situationVi: "a".repeat(101),
        situationEn: "ok",
        answerVi: "a".repeat(4001),
        answerEn: "b\u0007",
      }),
    ).toEqual({ situationVi: ["tooLong"], answerVi: ["tooLong"], answerEn: ["invalidCharacters"] });
  });
});

describe("scriptOrderSchema", () => {
  it("needs ids, at least one", () => {
    expect(errors(scriptOrderSchema, { scriptIds: [] })).toEqual({ scriptIds: ["required"] });
    expect(errors(scriptOrderSchema, { scriptIds: ["x"] })).toHaveProperty("scriptIds");
  });
});

describe("listScriptsQuerySchema", () => {
  it("reads includeInactive as a flag", () => {
    expect(listScriptsQuerySchema.parse({ includeInactive: "true" }).includeInactive).toBe(true);
    expect(listScriptsQuerySchema.parse({}).includeInactive).toBe(false);
  });
});

describe("leadNoteInputSchema (A-074)", () => {
  it("trims the note and refuses an empty, oversized, or control-character one", () => {
    expect(leadNoteInputSchema.parse({ body: "  Gọi lại  " })).toEqual({ body: "Gọi lại" });
    expect(errors(leadNoteInputSchema, { body: "  " })).toEqual({ body: ["required"] });
    expect(errors(leadNoteInputSchema, { body: "a".repeat(2001) })).toEqual({ body: ["tooLong"] });
    expect(errors(leadNoteInputSchema, { body: "a\u0000" })).toEqual({ body: ["invalidCharacters"] });
  });
});

describe("scriptLanguage (A-073)", () => {
  it("answers foreigners in English and everyone else in Vietnamese", () => {
    expect(scriptLanguage("FOREIGN")).toBe("en");
    expect(scriptLanguage("VIETNAM")).toBe("vi");
    expect(scriptLanguage(null)).toBe("vi");
  });
});
