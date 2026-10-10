import { describe, expect, it } from "vitest";
import { AppError } from "../errors/app-error.js";
import { assertCan } from "./assert.js";

describe("assertCan", () => {
  it("throws FORBIDDEN", () => {
    expect(() => assertCan({ role: "TRAINER" }, "user.manage")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }) as unknown as AppError,
    );
  });
});
