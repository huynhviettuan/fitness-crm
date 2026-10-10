import { z } from "zod";
import { listOf } from "../validation/index.js";
import { TRAINER_STATUSES } from "./trainer.schema.js";

export const trainerSchema = z
  .object({
    id: z.uuid(),
    trainerCode: z.string(),
    fullName: z.string(),
    status: z.enum(TRAINER_STATUSES),
    /** The linked login (A-010), if any. */
    user: z.object({ id: z.uuid(), name: z.string(), email: z.string() }).nullable(),
  })
  .meta({ id: "Trainer" });

export const trainerListSchema = listOf(trainerSchema).meta({ id: "TrainerList" });

/** How other records refer to their trainer. */
export const trainerRefSchema = z
  .object({ id: z.uuid(), trainerCode: z.string(), fullName: z.string() })
  .meta({ id: "TrainerRef" });

/** A login that can be linked to a trainer record: a user with the TRAINER role (A-010). */
export const trainerLoginSchema = z
  .object({ id: z.uuid(), name: z.string(), email: z.string(), linkedTrainerId: z.uuid().nullable() })
  .meta({ id: "TrainerLogin" });

export const trainerLoginListSchema = listOf(trainerLoginSchema).meta({ id: "TrainerLoginList" });

export type Trainer = z.output<typeof trainerSchema>;
export type TrainerRef = z.output<typeof trainerRefSchema>;
export type TrainerLogin = z.output<typeof trainerLoginSchema>;
