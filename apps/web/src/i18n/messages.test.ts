import { describe, expect, it } from "vitest";
import en from "../../messages/en.json";
import vi from "../../messages/vi.json";
import { ERROR_HTTP_STATUS } from "@gymcrm/shared/errors";
import { localeFromAcceptLanguage } from "@/i18n/config";

function keys(value: unknown, prefix = ""): string[] {
  if (typeof value !== "object" || value === null) return [prefix];
  return Object.entries(value).flatMap(([key, child]) => keys(child, prefix ? `${prefix}.${key}` : key));
}

describe("message catalogs", () => {
  it("vi.json and en.json have exactly the same keys", () => {
    expect(keys(en).sort()).toEqual(keys(vi).sort());
  });

  it("every error code has a message (docs/07)", () => {
    for (const code of Object.keys(ERROR_HTTP_STATUS)) {
      expect(vi.errors).toHaveProperty(code);
    }
  });
});

describe("localeFromAcceptLanguage", () => {
  it.each([
    ["vi-VN,vi;q=0.9,en;q=0.8", "vi"],
    ["en-US,en;q=0.9", "en"],
    ["fr-FR,fr;q=0.9", "vi"],
    [null, "vi"],
  ])("%j -> %s", (header, expected) => {
    expect(localeFromAcceptLanguage(header)).toBe(expected);
  });
});
