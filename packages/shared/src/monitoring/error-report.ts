// Error monitoring (M9.4c, A-313, doc 15): unexpected server errors of the API, the worker and the web server go to Sentry
// through its HTTP envelope endpoint, without its SDK. What leaves is the error's type, a scrubbed message, the stack,
// the method and the route with ids replaced, the service, the release and the environment. Never a request body, a
// header, a cookie, a query string, a user, or a value: emails, phone and ID numbers, and quoted values are removed from
// the message first. Reporting never throws and never waits long; a burst is cut to a few events a minute.

export type Dsn = { endpoint: string; publicKey: string; dsn: string };

/** https://<public key>@<host>/<project id> → where envelopes go and the key that signs them; null when not a DSN. */
export function parseDsn(value: string | undefined): Dsn | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    const project = url.pathname.replace(/^\/+|\/+$/g, "");
    if (!/^https?:$/.test(url.protocol) || !url.username || !/^\d+$/.test(project.split("/").pop() ?? "")) return null;
    const prefix = project.split("/").slice(0, -1).join("/");
    const projectId = project.split("/").pop()!;
    return {
      endpoint: `${url.protocol}//${url.host}/${prefix ? `${prefix}/` : ""}api/${projectId}/envelope/`,
      publicKey: decodeURIComponent(url.username),
      dsn: value,
    };
  } catch {
    return null;
  }
}

const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;

/** Personal data out of a message: emails, long digit runs (phones, ID numbers, amounts), quoted values, ids. */
export function scrubText(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(UUID, ":id")
    .replace(/(["'`])(?:(?!\1).){1,200}\1/g, "$1…$1")
    .replace(/\+?\d[\d\s.-]{4,}\d/g, "[number]")
    .slice(0, 1000);
}

/** The path without its query, ids and long numbers replaced: /api/v1/customers/:id. */
export function scrubPath(path: string): string {
  return (path.split("?")[0] ?? "").replace(UUID, ":id").replace(/\/\d{4,}(?=\/|$)/g, "/:n");
}

export type StackFrame = { function?: string; filename: string; lineno?: number; colno?: number; in_app: boolean };

/** V8's stack lines → Sentry frames, oldest call first. */
export function parseStack(stack: string | undefined): StackFrame[] {
  const frames: StackFrame[] = [];
  for (const line of (stack ?? "").split("\n")) {
    const match = /^\s*at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line);
    if (!match) continue;
    const filename = match[2]!.replace(/^file:\/\//, "");
    frames.push({
      ...(match[1] ? { function: match[1] } : {}),
      filename,
      lineno: Number(match[3]),
      colno: Number(match[4]),
      in_app: !/node_modules|^node:|^internal\//.test(filename),
    });
  }
  return frames.reverse();
}

export type ErrorContext = {
  /** Where it happened: "api", "worker", "web". */
  service: string;
  method?: string;
  path?: string;
  /** What was running: "request", "job:backup", "render", … */
  kind?: string;
  /** The web's error digest, to find the server log line. */
  digest?: string;
};

type ExceptionValue = { type: string; value: string; stacktrace?: { frames: StackFrame[] } };

function exceptionValues(error: unknown): ExceptionValue[] {
  const values: ExceptionValue[] = [];
  let current: unknown = error;
  // The error and its causes, innermost first as Sentry expects; at most three deep.
  for (let depth = 0; depth < 3 && current !== undefined && current !== null; depth += 1) {
    const thrown: Error | null = current instanceof Error ? current : null;
    const frames = thrown ? parseStack(thrown.stack) : [];
    values.unshift({
      type: thrown ? thrown.name || "Error" : typeof current,
      value: scrubText(thrown ? thrown.message : String(current)),
      ...(frames.length > 0 ? { stacktrace: { frames } } : {}),
    });
    current = thrown ? (thrown as Error & { cause?: unknown }).cause : undefined;
  }
  return values;
}

export type ReporterOptions = {
  dsn: string | undefined;
  release: string | null;
  environment: string;
  /** Events allowed per minute; the rest of a burst is dropped. */
  perMinute?: number;
  fetch?: typeof fetch;
  now?: () => Date;
};

export type ErrorReporter = {
  readonly enabled: boolean;
  /** Sends one event; resolves to whether it was sent. Never throws. */
  report(error: unknown, context: ErrorContext): Promise<boolean>;
};

const randomHex = (bytes: number) =>
  Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");

/** The envelope Sentry takes: a header line, an item header line, the event. */
export function buildEnvelope(dsn: Dsn, event: Record<string, unknown> & { event_id: string }, sentAt: Date): string {
  return [
    JSON.stringify({ event_id: event.event_id, sent_at: sentAt.toISOString(), dsn: dsn.dsn }),
    JSON.stringify({ type: "event" }),
    JSON.stringify(event),
  ].join("\n");
}

export function createErrorReporter(options: ReporterOptions): ErrorReporter {
  const dsn = parseDsn(options.dsn);
  const send = options.fetch ?? fetch;
  const now = options.now ?? (() => new Date());
  const perMinute = options.perMinute ?? 20;
  let windowStart = 0;
  let sentInWindow = 0;
  return {
    enabled: dsn !== null,
    async report(error, context) {
      if (!dsn) return false;
      const at = now();
      if (at.getTime() - windowStart >= 60_000) {
        windowStart = at.getTime();
        sentInWindow = 0;
      }
      if (sentInWindow >= perMinute) return false;
      sentInWindow += 1;
      const path = context.path ? scrubPath(context.path) : undefined;
      const event = {
        event_id: randomHex(16),
        timestamp: at.getTime() / 1000,
        platform: "node",
        level: "error",
        logger: context.service,
        environment: options.environment,
        ...(options.release ? { release: options.release } : {}),
        ...(path ? { transaction: `${context.method ?? ""} ${path}`.trim() } : {}),
        tags: {
          service: context.service,
          ...(context.kind ? { kind: context.kind } : {}),
          ...(context.digest ? { digest: context.digest } : {}),
        },
        exception: { values: exceptionValues(error) },
        ...(path ? { request: { method: context.method, url: path } } : {}),
      };
      try {
        const response = await send(dsn.endpoint, {
          method: "POST",
          headers: {
            "content-type": "application/x-sentry-envelope",
            "x-sentry-auth": `Sentry sentry_version=7, sentry_key=${dsn.publicKey}, sentry_client=flow-crm/1.0`,
          },
          body: buildEnvelope(dsn, event, at),
          signal: AbortSignal.timeout(3_000),
        });
        return response.ok;
      } catch {
        return false;
      }
    },
  };
}
