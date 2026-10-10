import { z } from "zod";
import { hasNoControlCharacters, listOf } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** FR-PLT-004. Branches are never deleted, only made inactive (D-035). */
export const branchInputSchema = z.object({
  name: text(100).pipe(z.string().min(1, { error: "required" })),
  address: text(300).transform(emptyToNull).prefault(""),
  active: z.boolean({ error: "invalidChoice" }).prefault(true),
});

/**
 * The branch a new record belongs to (D-014). Optional when the user works in one
 * branch only; the API then takes that branch.
 */
export const branchChoice = z
  .union([z.literal(""), z.uuid({ error: "invalidChoice" })])
  .optional()
  .transform((value) => value || undefined);

export const branchSchema = z
  .object({ id: z.uuid(), name: z.string(), address: z.string().nullable(), active: z.boolean() })
  .meta({ id: "Branch" });

export const branchListSchema = listOf(branchSchema).meta({ id: "BranchList" });

/** How other records name their branch. */
export const branchRefSchema = z.object({ id: z.uuid(), name: z.string() }).meta({ id: "BranchRef" });

export type BranchInput = z.input<typeof branchInputSchema>;
export type Branch = z.output<typeof branchSchema>;
export type BranchRef = z.output<typeof branchRefSchema>;
