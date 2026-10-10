import { z } from "zod";
import { hasNoControlCharacters } from "@/lib/validation/text";

// Error messages are i18n keys under `validation.*` in messages/*.json.

/** A-003: trainer codes are "PT" + at least 3 digits, e.g. PT001. */
export function formatTrainerCode(sequenceValue: bigint | number): string {
  return `PT${sequenceValue.toString().padStart(3, "0")}`;
}

const fullName = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(150, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" });

/** The linked login (A-010). The form sends "" for "no login". */
const userId = z
  .union([z.literal(""), z.null(), z.uuid({ error: "invalidChoice" })])
  .transform((value) => value || null);

/** Create and update take the same fields; the trainer code is never accepted (T-019). */
export const trainerInputSchema = z.object({
  fullName,
  status: z.enum(["ACTIVE", "INACTIVE"], { error: "invalidChoice" }).prefault("ACTIVE"),
  userId: userId.prefault(""),
});

export const listTrainersSchema = z.object({
  /** Only trainers who can take new bookings. */
  activeOnly: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .transform((value) => value === true || value === "true")
    .prefault(false),
});

export type TrainerInput = z.input<typeof trainerInputSchema>;
export type TrainerData = z.output<typeof trainerInputSchema>;
