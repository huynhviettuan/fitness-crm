import { z } from "zod";
import { instant } from "../validation/index.js";

/**
 * What `GET /health` answers (liveness, A-315): the process is up. The hosting platform's health check: it never reads the
 * database, so a slow database does not make the platform restart a working API.
 */
export const livenessSchema = z
  .object({
    status: z.literal("ok"),
    /** The deployed commit (or the RELEASE setting), shortened; null when the platform does not say. */
    release: z.string().nullable(),
    time: instant,
  })
  .meta({ id: "Liveness" });

export type Liveness = z.infer<typeof livenessSchema>;

/**
 * What `GET /health/ready` answers (readiness, M9.4, A-311, A-315): for the uptime monitor and the start of the E2E run,
 * without a session. It says only whether the API can reach its database, which release is running, and the server's time.
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
