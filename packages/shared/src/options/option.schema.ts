import { z } from "zod";
import { hasNoControlCharacters, listOf } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/**
 * Option lists (D-016). The keys are fixed by the flows that use them; the options
 * are configuration admin manages on screen. Each list has one "Khác" (Other) option,
 * which needs a note wherever it is chosen. Lists are added with the features that
 * use them.
 */
export const OPTION_LISTS = [
  "paymentMethods",
  "incomeCategories",
  "expenseTypes",
  "deleteReasons",
  "rejectReasons",
  "departments",
  "jobTitles",
  // The lead profile (brief §4.1), M2 slice 1.
  "leadChannels",
  "leadSources",
  "needGroups",
  "painStatuses",
  "assessmentTypes",
] as const;
export type OptionListKey = (typeof OPTION_LISTS)[number];

export function isOptionList(value: string): value is OptionListKey {
  return (OPTION_LISTS as readonly string[]).includes(value);
}

const label = text(100).pipe(z.string().min(1, { error: "required" }));

/** Adding or editing an option. Options are never deleted, only made inactive. */
export const optionInputSchema = z.object({
  labelVi: label,
  labelEn: label,
  active: z.boolean({ error: "invalidChoice" }).prefault(true),
});

/** The whole list in its new order. */
export const optionOrderSchema = z.object({
  optionIds: z.array(z.uuid({ error: "invalidChoice" })).min(1, { error: "required" }).max(500, { error: "tooLong" }),
});

export const listOptionsQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

/** An option chosen in a form. Which list it must come from is the API's business. */
export const optionChoice = z.uuid({ error: "required" });

/** Optional for every option; required with "Khác" (checked by the API, which knows the option). */
export const optionNote = text(500).transform(emptyToNull).prefault("");

export const optionSchema = z
  .object({
    id: z.uuid(),
    listKey: z.enum(OPTION_LISTS),
    labelVi: z.string(),
    labelEn: z.string(),
    sortOrder: z.int(),
    active: z.boolean(),
    isOther: z.boolean(),
  })
  .meta({ id: "Option" });

export const optionListSchema = listOf(optionSchema).meta({ id: "OptionList" });

/** An option as a record shows it: the option chosen and the note written with it. */
export const chosenOptionSchema = z
  .object({ id: z.uuid(), labelVi: z.string(), labelEn: z.string(), isOther: z.boolean(), note: z.string().nullable() })
  .meta({ id: "ChosenOption" });

/** "Khác" notes written on a list, most used first, for admin to promote (FR-PLT-005). */
export const otherNoteSchema = z.object({ note: z.string(), count: z.int(), lastUsedAt: z.iso.datetime() });
export const otherNoteListSchema = listOf(otherNoteSchema).meta({ id: "OtherNoteList" });

export type OptionInput = z.input<typeof optionInputSchema>;
export type Option = z.output<typeof optionSchema>;
export type ChosenOption = z.output<typeof chosenOptionSchema>;
export type OtherNote = z.output<typeof otherNoteSchema>;
