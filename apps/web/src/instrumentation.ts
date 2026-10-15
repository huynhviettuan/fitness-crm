import type { Instrumentation } from "next";
import { createErrorReporter } from "@flow/shared/monitoring";

// Error monitoring for the web server (M9.4c, A-313): an error while rendering a page, in a Server Action or a route handler
// goes to Sentry when SENTRY_DSN is set. Only the method, the route file and the scrubbed path leave, with the error's
// digest so the server log line can be found; never the headers, cookies or the query. Errors in the browser are not
// sent (the CSP allows no other origin, doc 24).
const reporter = createErrorReporter({
  dsn: process.env.SENTRY_DSN,
  release: process.env.RELEASE || process.env.VERCEL_GIT_COMMIT_SHA || null,
  environment: process.env.SENTRY_ENVIRONMENT ?? process.env.VERCEL_ENV ?? process.env.NODE_ENV ?? "development",
});

export const onRequestError: Instrumentation.onRequestError = async (error, request, context) => {
  const digest =
    typeof error === "object" && error !== null && "digest" in error
      ? String((error as { digest: unknown }).digest)
      : undefined;
  await reporter.report(error, {
    service: "web",
    kind: `${context.routeType}:${context.routePath}`,
    method: request.method,
    path: request.path,
    digest,
  });
};
