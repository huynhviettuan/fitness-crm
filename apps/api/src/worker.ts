import "dotenv/config";
import { startJobs } from "./jobs.js";
import { watchProcess } from "./platform/monitoring.js";

// The worker process (T-045, T-059): the API's code started in worker mode, running
// only the background jobs. In production the API runs with RUN_JOBS=false.

watchProcess("worker");
const jobs = await startJobs();
console.info("Worker started: reminders every minute");

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.once(signal, () => {
    void jobs.stop().finally(() => process.exit(0));
  });
}
