import { z } from "zod";
import { isCountryCode } from "./country.js";

// Error messages are i18n keys under `validation.*` in the web app's messages/*.json.
const normalized = (value: unknown) => (typeof value === "string" ? value.trim().toUpperCase() : value);

/** A country of ISO 3166-1 (D-057); "" or null for none, which a person from an old import may have. */
export const optionalCountry = z.preprocess(
  (value) => (typeof value === "string" ? normalized(value) || null : value),
  z.string().refine(isCountryCode, { error: "invalidChoice" }).nullable(),
);

/** A country that must be given, e.g. at Show (brief §4.1). */
export const requiredCountry = z.preprocess(
  normalized,
  z.string({ error: "required" }).min(1, { error: "required" }).refine(isCountryCode, { error: "invalidChoice" }),
);
