import { z } from "zod";
import { hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

const situation = z
  .string({ error: "required" })
  .trim()
  .min(1, { error: "required" })
  .max(100, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** An answer is plain text with line breaks, which `hasNoControlCharacters` allows. */
const answer = z
  .string()
  .trim()
  .max(4000, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" })
  .transform(emptyToNull);

/** A situation and its answer in both languages (A-072). */
const scriptFields = {
  situationVi: situation,
  situationEn: situation,
  answerVi: answer.prefault(""),
  answerEn: answer.prefault(""),
  active: z.boolean({ error: "invalidChoice" }).prefault(true),
};

export const scriptInputSchema = z.object(scriptFields);

/** The whole library in its new order (like the option lists). */
export const scriptOrderSchema = z.object({
  scriptIds: z
    .array(z.uuid({ error: "invalidChoice" }))
    .min(1, { error: "required" })
    .max(500, { error: "tooLong" }),
});

export const listScriptsQuerySchema = z.object({
  /** Managers also see the inactive ones. */
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export type ScriptInput = z.input<typeof scriptInputSchema>;

export type ScriptLanguage = "vi" | "en";

/** The language of a lead's answer follows its nationality group: Foreign is English, anything else Vietnamese (A-073). */
export function scriptLanguage(nationalityGroup: "VIETNAM" | "FOREIGN" | null): ScriptLanguage {
  return nationalityGroup === "FOREIGN" ? "en" : "vi";
}
