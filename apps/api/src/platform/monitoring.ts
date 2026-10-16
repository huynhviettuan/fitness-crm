import { createErrorReporter, type ErrorContext } from "@gymcrm/shared/monitoring";
import { env, release } from "./env.js";

// Error monitoring (M9.4c, A-313): unexpected errors go to Sentry when SENTRY_DSN is set; without it nothing leaves.
export const errorReporter = createErrorReporter({
  dsn: env.SENTRY_DSN,
  release,
  environment: env.SENTRY_ENVIRONMENT ?? env.NODE_ENV,
});

/** Reports, then lets the caller go on (rethrow, answer 500); never waits for Sentry. */
export function reportError(error: unknown, context: ErrorContext): void {
  void errorReporter.report(error, context);
}

/**
 * Errors nothing caught: reported, then the process ends as Node would have ended it (the platform restarts it), after
 * at most the reporter's 3-second wait.
 */
export function watchProcess(service: "api" | "worker"): void {
  for (const kind of ["unhandledRejection", "uncaughtException"] as const) {
    process.on(kind, (error: unknown) => {
      console.error(`${kind} in ${service}`, error);
      void errorReporter.report(error, { service, kind }).finally(() => process.exit(1));
    });
  }
}
