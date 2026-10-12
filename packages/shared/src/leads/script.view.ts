import { z } from "zod";
import { listOf } from "../validation/index.js";

export const scriptSchema = z
  .object({
    id: z.uuid(),
    situationVi: z.string(),
    situationEn: z.string(),
    /** Empty until the owner's answers are entered on screen (A-072). */
    answerVi: z.string().nullable(),
    answerEn: z.string().nullable(),
    active: z.boolean(),
    sortOrder: z.int(),
  })
  .meta({ id: "ConsultingScript" });

export const scriptListSchema = listOf(scriptSchema).meta({ id: "ConsultingScriptList" });

export type ConsultingScript = z.output<typeof scriptSchema>;
