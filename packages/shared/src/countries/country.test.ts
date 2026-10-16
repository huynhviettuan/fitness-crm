import { describe, expect, it } from "vitest";
import { COUNTRY_CODES, countryName, isCountryCode, nationalityGroupOf } from "./country.js";
import { optionalCountry, requiredCountry } from "./country.schema.js";

describe("countries (D-057)", () => {
  it("holds every ISO 3166-1 country once, each with a name", () => {
    expect(COUNTRY_CODES).toHaveLength(249);
    expect(new Set(COUNTRY_CODES).size).toBe(COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) expect(countryName(code, "en"), code).not.toBe(code);
  });

  it("writes the name in the language asked", () => {
    expect(countryName("VN", "en")).toBe("Vietnam");
    expect(countryName("VN", "vi")).toBe("Việt Nam");
    expect(countryName("JP", "vi")).toBe("Nhật Bản");
  });

  it("derives the group from the country", () => {
    expect(nationalityGroupOf("VN")).toBe("VIETNAM");
    expect(nationalityGroupOf("US")).toBe("FOREIGN");
    expect(nationalityGroupOf(null)).toBeNull();
    expect(nationalityGroupOf("")).toBeNull();
  });

  it("knows what is a country", () => {
    expect(isCountryCode("VN")).toBe(true);
    expect(isCountryCode("XX")).toBe(false);
    expect(isCountryCode("vn")).toBe(false);
  });

  it("reads an optional country as upper case, or none", () => {
    expect(optionalCountry.parse(" vn ")).toBe("VN");
    expect(optionalCountry.parse("")).toBeNull();
    expect(optionalCountry.parse(null)).toBeNull();
    expect(optionalCountry.safeParse("Vietnam").success).toBe(false);
  });

  it("requires a country where one must be given", () => {
    expect(requiredCountry.parse("kr")).toBe("KR");
    expect(requiredCountry.safeParse("").success).toBe(false);
    expect(requiredCountry.safeParse(undefined).success).toBe(false);
    expect(requiredCountry.safeParse("ZZ").success).toBe(false);
  });
});
