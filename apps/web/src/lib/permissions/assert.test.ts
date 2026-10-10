import { describe, expect, it } from "vitest";
import { AppError } from "@/lib/errors/app-error";
import { assertCan } from "@/lib/permissions/assert";

describe("assertCan", () => {
  it("throws FORBIDDEN", () => {
    expect(() => assertCan({ role: "TRAINER" }, "user.manage")).toThrow(
      expect.objectContaining({ code: "FORBIDDEN" }) as unknown as AppError,
    );
  });
});
