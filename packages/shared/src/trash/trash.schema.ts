import { z } from "zod";
import { branchRefSchema } from "../branches/branch.schema.js";
import { chosenOptionSchema, optionChoice, optionNote } from "../options/option.schema.js";
import { calendarDate, instant, pageOf } from "../validation/index.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.

/**
 * Deleting a business record (D-035, FR-TRASH-001): a reason from the "deleteReasons"
 * list, and a note, which "Khác" requires. The record moves to the trash.
 */
export const deleteSchema = z.object({
  reasonId: optionChoice,
  reasonNote: optionNote,
});

/** What can be deleted so far; each module adds its records when it is built. */
export const TRASH_ENTITY_TYPES = ["payment", "cash_transaction"] as const;
export type TrashEntityType = (typeof TRASH_ENTITY_TYPES)[number];

const optionalDate = z.union([z.literal(""), calendarDate]).optional().transform((value) => value || undefined);

export const listTrashSchema = z.object({
  entityType: z.preprocess((value) => (value === "" ? undefined : value), z.enum(TRASH_ENTITY_TYPES, { error: "invalidChoice" }).optional()),
  /** First and last day deleted, inclusive (dd/MM/yyyy). */
  from: optionalDate,
  to: optionalDate,
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

/**
 * A deleted record, kept forever (D-035): who deleted it, when, why, and the record as
 * it was. `snapshot` has the record's own response shape (e.g. `Payment`).
 */
export const trashEntrySchema = z
  .object({
    id: z.uuid(),
    entityType: z.enum(TRASH_ENTITY_TYPES),
    entityId: z.uuid(),
    branch: branchRefSchema,
    /** A short name for the record, e.g. the contract code and customer of a receipt. */
    title: z.string(),
    /** Null when receipt totals are hidden from the viewer (D-017). */
    amount: z.int().nullable(),
    deletedAt: instant,
    deletedBy: z.string(),
    reason: chosenOptionSchema,
    snapshot: z.record(z.string(), z.unknown()),
  })
  .meta({ id: "TrashEntry" });

export const trashPageSchema = pageOf(trashEntrySchema).meta({ id: "TrashPage" });

export type DeleteInput = z.input<typeof deleteSchema>;
export type TrashEntry = z.output<typeof trashEntrySchema>;
