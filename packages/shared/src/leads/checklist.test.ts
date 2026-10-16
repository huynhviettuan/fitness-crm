import { describe, expect, it } from "vitest";
import { z } from "zod";
import { checklistInputSchema, offsetParts, stepCompleteSchema, type ChecklistInput } from "./checklist.schema.js";

type StepInput = ChecklistInput["steps"][number];

const step = (overrides: Partial<StepInput> = {}): StepInput => ({
  key: "tu-van",
  labelVi: "Tư vấn",
  labelEn: "Consult",
  trigger: "ASSIGNED",
  offsetValue: 60,
  offsetUnit: "MINUTES",
  results: [{ labelVi: "Done", labelEn: "Done" }],
  ...overrides,
});

const errors = (input: unknown) => {
  const result = checklistInputSchema.safeParse(input);
  return result.success
    ? {}
    : Object.fromEntries(result.error.issues.map((issue) => [issue.path.join("."), issue.message]));
};

describe("checklistInputSchema (D-020)", () => {
  it("stores delays in minutes, counting back from the appointment", () => {
    const { steps } = checklistInputSchema.parse({
      steps: [
        step(),
        step({ key: "nhac-1", trigger: "STATUS", triggerStatus: "NO_RESPONSE", offsetValue: 24, offsetUnit: "HOURS" }),
        step({ key: "truoc-hen", trigger: "APPOINTMENT", offsetValue: 3, offsetUnit: "HOURS" }),
        step({ key: "bao-studio", trigger: "AFTER_STEP", triggerStepKey: "truoc-hen", offsetValue: 0 }),
        step({ key: "tai-cham-soc", trigger: "RECARE", offsetValue: 15, offsetUnit: "DAYS" }),
      ],
    });

    expect(steps.map((s) => [s.key, s.trigger, s.triggerStatus, s.triggerStepKey, s.offsetMinutes])).toEqual([
      ["tu-van", "ASSIGNED", null, null, 60],
      ["nhac-1", "STATUS", "NO_RESPONSE", null, 1440],
      ["truoc-hen", "APPOINTMENT", null, null, -180],
      ["bao-studio", "AFTER_STEP", null, "truoc-hen", 0],
      // The re-care day comes from the lead (parameter recareDays), not from the step.
      ["tai-cham-soc", "RECARE", null, null, 0],
    ]);
    expect(steps[0].required).toBe(false);
  });

  it("needs the status of a STATUS step, and an earlier step for AFTER_STEP", () => {
    expect(
      errors({
        steps: [
          step({ trigger: "STATUS" }),
          step({ key: "sau", trigger: "AFTER_STEP", triggerStepKey: "sau" }),
          step({ key: "tu-van" }),
        ],
      }),
    ).toEqual({
      "steps.0.triggerStatus": "required",
      "steps.1.triggerStepKey": "invalidChoice",
      "steps.2.key": "duplicate",
    });
    expect(errors({ steps: [step({ trigger: "STATUS", triggerStatus: "NEW" })] })).toEqual({
      "steps.0.triggerStatus": "invalidChoice",
    });
  });

  it("checks keys, labels, delays, and results", () => {
    expect(errors({ steps: [] })).toEqual({ steps: "required" });
    expect(errors({ steps: [step({ key: "Tư vấn", labelVi: "", offsetValue: 1000, results: [] })] })).toEqual({
      "steps.0.key": "invalidKey",
      "steps.0.labelVi": "required",
      "steps.0.offsetValue": "invalidNumber",
      "steps.0.results": "required",
    });
    expect(
      z.flattenError(checklistInputSchema.safeParse({ steps: [step({ labelEn: "a\u0000" })] }).error!).fieldErrors,
    ).toEqual({
      steps: ["invalidCharacters"],
    });
  });
});

describe("offsetParts", () => {
  it("shows a delay in the largest whole unit", () => {
    expect(offsetParts(1440 * 15)).toEqual({ offsetValue: 15, offsetUnit: "DAYS" });
    expect(offsetParts(-180)).toEqual({ offsetValue: 3, offsetUnit: "HOURS" });
    expect(offsetParts(90)).toEqual({ offsetValue: 90, offsetUnit: "MINUTES" });
    expect(offsetParts(0)).toEqual({ offsetValue: 0, offsetUnit: "MINUTES" });
  });
});

describe("stepCompleteSchema", () => {
  it("takes a result and an optional note", () => {
    expect(stepCompleteSchema.parse({ resultIndex: "1", note: " Khách xác nhận qua Zalo " })).toEqual({
      resultIndex: 1,
      note: "Khách xác nhận qua Zalo",
    });
    expect(stepCompleteSchema.parse({ resultIndex: 0 })).toEqual({ resultIndex: 0, note: null });
    expect(stepCompleteSchema.safeParse({ resultIndex: -1 }).success).toBe(false);
    expect(stepCompleteSchema.safeParse({}).success).toBe(false);
  });
});
