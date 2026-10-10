import "server-only";
import { headers } from "next/headers";
import createClient from "openapi-fetch";
import type { z } from "zod";
import { env } from "@/lib/env";
import { ApiError } from "./errors";
import type { paths } from "./schema";

/** What the API needs from the browser's request: the session cookie and who is calling. */
const FORWARDED_HEADERS = ["cookie", "origin", "user-agent", "accept-language", "x-forwarded-for"] as const;

/**
 * A typed client for the API (T-043), generated from apps/api/openapi.json. It acts as
 * the signed-in user by forwarding the request's session cookie; the API authenticates
 * and authorizes every call. Server Actions also forward the Origin, which Next.js has
 * already checked, so the API's own Origin check (T-033) passes.
 */
export async function api() {
  const incoming = await headers();
  const forwarded: Record<string, string> = {};
  for (const name of FORWARDED_HEADERS) {
    const value = incoming.get(name);
    if (value) forwarded[name] = value;
  }
  return createClient<paths>({ baseUrl: env.API_URL, headers: forwarded, cache: "no-store" });
}

type Answer = { data?: unknown; error?: unknown; response: Response };

/** The response body decoded with its shared schema (dates become Date objects), or an ApiError. */
export async function read<S extends z.ZodType>(schema: S, call: Promise<Answer>): Promise<z.output<S>> {
  const { data, error, response } = await call;
  if (!response.ok) throw ApiError.fromResponse(response.status, error);
  return schema.parse(data);
}

/**
 * For actions under the approval matrix (D-018) that answer 204 when done or 202 when
 * waiting for approval: true when the change was submitted for approval.
 */
export async function submittedOrDone(call: Promise<Answer>): Promise<boolean> {
  const { error, response } = await call;
  if (!response.ok) throw ApiError.fromResponse(response.status, error);
  return response.status === 202;
}

/** For calls that answer 204 No Content. */
export async function done(call: Promise<Answer>): Promise<void> {
  const { error, response } = await call;
  if (!response.ok) throw ApiError.fromResponse(response.status, error);
}

/** Query values as the API takes them: strings, with empty values left out. */
export function query<T extends Record<string, string | number | boolean | undefined>>(values: T) {
  return Object.fromEntries(
    Object.entries(values).flatMap(([key, value]) => (value === undefined || value === "" ? [] : [[key, String(value)]])),
  ) as { [K in keyof T]?: string };
}
