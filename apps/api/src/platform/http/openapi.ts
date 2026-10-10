import { applyDecorators } from "@nestjs/common";
import { ApiDefaultResponse, ApiHeader, ApiQuery, ApiResponse } from "@nestjs/swagger";
import type { StandardSchemaConverter } from "@nestjs/swagger";
import { z } from "zod";
import { apiErrorSchema } from "@flow/shared/errors";

// The OpenAPI document is generated from the controllers and the Zod schemas in
// @flow/shared (docs/07). It is the contract the web app's client is generated from.

const DEFINITIONS_REF = /^#\/(definitions|\$defs)\//;

/**
 * Converts a Zod schema to OpenAPI 3.0 for @nestjs/swagger. Request bodies and responses
 * both travel as the schema's input side (dates as ISO strings, see validation/codecs.ts),
 * so the input side is documented for both.
 */
export const zodToOpenApi: StandardSchemaConverter = (schema) => {
  if (!(schema instanceof z.ZodType)) return undefined;
  const json = z.toJSONSchema(schema, { target: "openapi-3.0", io: "input", unrepresentable: "any" }) as Record<
    string,
    unknown
  >;
  const { definitions, $defs, $schema: _, ...root } = json;
  void _;
  const components = (definitions ?? $defs ?? {}) as Record<string, unknown>;
  return {
    schema: tidy(root),
    components: Object.fromEntries(Object.entries(components).map(([name, value]) => [name, tidy(value)])),
  };
};

/**
 * Drops validation noise that makes the document hard to read without adding meaning
 * for clients: the regexes behind `format: uuid` and `format: date-time`, and the
 * safe-integer bounds on every integer.
 */
function tidy(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(tidy);
  if (!value || typeof value !== "object") return value;
  const node = { ...(value as Record<string, unknown>) };
  if (node.format === "uuid" || node.format === "date-time") delete node.pattern;
  if (node.type === "integer" && node.minimum === Number.MIN_SAFE_INTEGER) delete node.minimum;
  if (node.type === "integer" && node.maximum === Number.MAX_SAFE_INTEGER) delete node.maximum;
  if (typeof node.$ref === "string") node.$ref = node.$ref.replace(DEFINITIONS_REF, "#/components/schemas/");
  for (const [key, child] of Object.entries(node)) node[key] = tidy(child);
  return node;
}

/** A response described by a shared Zod schema. */
export function ApiResult(schema: z.ZodType, status = 200, description = "OK") {
  return ApiResponse({ status, description, standardSchema: schema });
}

/** Every error leaves in the documented shape (docs/07 "Error contract"). */
export function ApiErrors() {
  return ApiDefaultResponse({ description: "Error (docs/07 error contract)", standardSchema: apiErrorSchema });
}

/** Query parameters that may be left out; all are strings on the wire. */
export function ApiOptionalQuery(...names: string[]) {
  return applyDecorators(...names.map((name) => ApiQuery({ name, required: false, type: String })));
}

/** T-015: creates of contracts and money records carry a client-generated UUID. */
export function ApiIdempotencyKey() {
  return ApiHeader({ name: "Idempotency-Key", required: true, description: "A UUID generated when the form opens (T-015)." });
}
