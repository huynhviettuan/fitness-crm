import { z } from "zod";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
// Forms send text; API clients may send a number.

/** A whole number from `min` to `max`, typed or sent. */
export const wholeNumber = (min: number, max: number) =>
  z
    .union([z.number(), z.string()], { error: "invalidNumber" })
    .pipe(
      z.coerce
        .number<string | number>({ error: "invalidNumber" })
        .int({ error: "invalidNumber" })
        .min(min, { error: "invalidNumber" })
        .max(max, { error: "invalidNumber" }),
    );

/** A whole number, or empty for none. */
export const optionalWhole = (min: number, max: number) =>
  z
    .union([z.literal(""), z.null(), wholeNumber(min, max)], { error: "invalidNumber" })
    .transform((value) => (value === "" ? null : value));

/** A percent from `min` to `max` with up to two decimals; a decimal comma reads like a dot. */
export const percentNumber = (min = 0, max = 100) =>
  z
    .union([z.number(), z.string()], { error: "invalidNumber" })
    .transform((value) => (typeof value === "string" ? value.replace(",", ".") : value))
    .pipe(
      z.coerce
        .number<string | number>({ error: "invalidNumber" })
        .min(min, { error: "invalidPercent" })
        .max(max, { error: "invalidPercent" }),
    )
    .transform((value) => Math.round(value * 100) / 100);
