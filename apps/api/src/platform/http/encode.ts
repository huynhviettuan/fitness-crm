import type { z } from "zod";

/**
 * Serializes a response with its shared schema: dates become ISO strings and fields
 * the schema does not list are dropped, so internal columns cannot leak. The type
 * check ties each service's result to the documented response.
 */
export function encode<S extends z.ZodType>(schema: S, value: z.output<S>): z.input<S> {
  return schema.encode(value);
}
