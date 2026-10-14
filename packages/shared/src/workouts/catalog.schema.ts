import { z } from "zod";
import { hasNoControlCharacters } from "../validation/index.js";
import { EXERCISE_KINDS } from "./catalog.domain.js";

// Workout catalogs (M7.1, brief §7.1): inputs. Error messages are i18n keys under `validation.*`.

// Form inputs send "" for an empty optional field; it is stored as null.
const emptyToNull = (value: string) => (value === "" ? null : value);

const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });
const name = (max = 100) => text(max).pipe(z.string().min(1, { error: "required" }));
const optional = <T extends z.ZodType>(schema: T) =>
  z.preprocess((value) => (value === "" ? undefined : value), schema.optional());
const optionalUuid = z
  .union([z.literal(""), z.null(), z.uuid({ error: "invalidChoice" })])
  .transform((value) => (value === "" ? null : value));

/** The short code the owner gives an entry, kept in capitals: letters, digits, dot, dash, underscore. */
const code = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(20, { error: "tooLong" })
  .regex(/^[A-Za-z0-9._-]+$/, { error: "invalidCode" })
  .transform((value) => value.toUpperCase());

/** A video is a link to a page, over https; the CRM stores the link and never the video. */
const videoUrl = z
  .union([z.literal(""), z.url({ protocol: /^https$/, error: "invalidUrl" }).max(500, { error: "tooLong" })])
  .transform(emptyToNull);

const active = z.boolean({ error: "invalidChoice" }).prefault(true);

/** Equipment: code, name, notes, validity (brief §7.1). */
export const equipmentInputSchema = z.object({
  code,
  name: name(),
  notes: text(500).transform(emptyToNull).prefault(""),
  active,
});

/** A body area: code, name, a parent for the tree, notes, validity. */
export const areaInputSchema = z.object({
  code,
  name: name(),
  parentId: optionalUuid.prefault(""),
  notes: text(500).transform(emptyToNull).prefault(""),
  active,
});

/** An exercise: name, area, equipment, description, video link, validity, and Strength or Cardio. */
export const exerciseInputSchema = z.object({
  name: name(150),
  areaId: z.uuid({ error: "required" }),
  /** Bodyweight and cardio exercises may need none. */
  equipmentId: optionalUuid.prefault(""),
  kind: z.enum(EXERCISE_KINDS, { error: "invalidChoice" }),
  description: text(2000).transform(emptyToNull).prefault(""),
  videoUrl: videoUrl.prefault(""),
  active,
});

/** A stage (phase of a plan): name, description, validity. Example: Rehab. */
export const stageInputSchema = z.object({
  name: name(),
  description: text(1000).transform(emptyToNull).prefault(""),
  active,
});

/** A whole small catalog; entries made inactive are left out unless asked for. */
export const catalogQuerySchema = z.object({
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
});

export const exerciseListQuerySchema = z.object({
  q: text(100).prefault(""),
  /** An area, and everything below it. */
  areaId: optional(z.uuid({ error: "invalidChoice" })),
  equipmentId: optional(z.uuid({ error: "invalidChoice" })),
  kind: optional(z.enum(EXERCISE_KINDS, { error: "invalidChoice" })),
  includeInactive: z
    .union([z.boolean(), z.enum(["true", "false"])])
    .optional()
    .transform((value) => value === true || value === "true"),
  page: z.coerce.number().int().min(1).optional().default(1),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20),
});

export type EquipmentInput = z.input<typeof equipmentInputSchema>;
export type AreaInput = z.input<typeof areaInputSchema>;
export type ExerciseInput = z.input<typeof exerciseInputSchema>;
export type StageInput = z.input<typeof stageInputSchema>;
