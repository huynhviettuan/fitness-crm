import "dotenv/config";
import { createApp } from "./app.js";
import { env } from "./platform/env.js";
import { startJobs } from "./jobs.js";

const app = await createApp({ docs: env.NODE_ENV !== "production" });
await app.listen(env.PORT);
console.info(`API listening on port ${env.PORT}`);

// T-059: in development the API also runs the reminders; in production the worker does.
if (env.RUN_JOBS) {
  const jobs = await startJobs();
  console.info("Background jobs started in the API process");
  for (const signal of ["SIGINT", "SIGTERM"] as const) process.once(signal, () => void jobs.stop());
}
