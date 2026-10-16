import { z } from "zod";
import { hasNoControlCharacters } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/** A note on a lead or its customer record (A-074): free text, never edited or deleted. */
export const leadNoteInputSchema = z.object({
  body: z
    .string({ error: "required" })
    .trim()
    .min(1, { error: "required" })
    .max(2000, { error: "tooLong" })
    .refine(hasNoControlCharacters, { error: "invalidCharacters" }),
});

export type LeadNoteInput = z.input<typeof leadNoteInputSchema>;
