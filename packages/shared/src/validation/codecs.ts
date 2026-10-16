import { z } from "zod";

// Response shapes travel as JSON. These codecs describe the wire format (`z.input`)
// and the in-code type (`z.output`): the API encodes with them, the web app decodes.

/** An instant as ISO 8601 UTC on the wire, a Date in code (docs/07 "Dates and money"). */
export const instant = z.codec(z.iso.datetime(), z.date(), {
  decode: (value) => new Date(value),
  encode: (date) => date.toISOString(),
});

/** One page of a list (docs/07 "Lists"). */
export function pageOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item), total: z.int(), page: z.int(), pageSize: z.int() });
}

/** A whole list without paging. */
export function listOf<T extends z.ZodType>(item: T) {
  return z.object({ items: z.array(item) });
}
