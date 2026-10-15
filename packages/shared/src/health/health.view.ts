import { z } from "zod";
import { instant } from "../validation/index.js";

/**
 * What `GET /health` answers (M9.4, A-311): for the hosting platform's health check and the uptime monitor, without a
 * session. It says only whether the API can reach its database, which release is running, and the server's time.
 */
export const healthSchema = z
  .object({
    status: z.enum(["ok", "unavailable"]),
    database: z.enum(["ok", "unavailable"]),
    /** The deployed commit (or the RELEASE setting), shortened; null when the platform does not say. */
    release: z.string().nullable(),
    time: instant,
  })
  .meta({ id: "Health" });

export type Health = z.infer<typeof healthSchema>;
