import { describe, expect, it } from "vitest";
import {
  canEditPlan,
  canRevisePlan,
  canSubmitPlan,
  expandTemplate,
  foreignFields,
  numberWeeksAcrossStages,
  planContentSchema,
  planCreateSchema,
  planListQuerySchema,
  planSetInputSchema,
  plannedSessions,
} from "./index.js";

const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";

describe("the life of a plan (D-018, D-022)", () => {
  it("is edited and submitted as a draft or after a rejection, and revised once approved", () => {
    expect(
      ["DRAFT", "REJECTED"].every((status) => canEditPlan(status as never) && canSubmitPlan(status as never)),
    ).toBe(true);
    for (const status of ["PENDING", "APPROVED", "SUPERSEDED"] as const) {
      expect(canEditPlan(status)).toBe(false);
      expect(canSubmitPlan(status)).toBe(false);
    }
    expect(canRevisePlan("APPROVED")).toBe(true);
    expect(canRevisePlan("DRAFT")).toBe(false);
    expect(canRevisePlan("SUPERSEDED")).toBe(false);
  });
});

describe("the targets of a set (brief §7.2)", () => {
  it("name the fields an exercise's kind does not have", () => {
    expect(foreignFields("STRENGTH", { weight: 60, reps: 8, speed: 9 })).toEqual(["speed"]);
    expect(foreignFields("CARDIO", { durationMinutes: 20, speed: 9, heartRate: 140, notes: "x" })).toEqual([]);
    expect(foreignFields("CARDIO", { weight: 10, videoUrl: "https://v.example.test/x", reps: null })).toEqual([
      "weight",
      "videoUrl",
    ]);
    expect(foreignFields("STRENGTH", { weight: null, speed: null })).toEqual([]);
  });

  it("are typed in a form as text, with a comma for decimals, and empty ones are nothing", () => {
    const set = planSetInputSchema.parse({
      weight: "62,5",
      reps: "8",
      restSeconds: "90",
      rir: "2",
      tempo: "3-1-1",
      notes: "",
    });
    expect(set).toMatchObject({
      weight: 62.5,
      reps: 8,
      restSeconds: 90,
      rir: 2,
      tempo: "3-1-1",
      notes: null,
      speed: null,
    });
    expect(planSetInputSchema.parse({})).toMatchObject({ weight: null, reps: null, videoUrl: null });
    expect(planSetInputSchema.parse({ durationMinutes: 20.5, speed: "9,5", heartRate: 140 })).toMatchObject({
      durationMinutes: 20.5,
      speed: 9.5,
      heartRate: 140,
    });
  });

  it("are refused outside their range, with a decimal where a whole number is needed, or with an unsafe video", () => {
    for (const bad of [
      { weight: "-1" },
      { weight: 1001 },
      { weight: "62,555" },
      { reps: "0" },
      { reps: "8,5" },
      { rir: 11 },
      { heartRate: 20 },
      { speed: 61 },
      { restSeconds: 4000 },
      { weight: "abc" },
      { videoUrl: "http://v.example.test/x" },
      { videoUrl: "javascript:alert(1)" },
      { tempo: "x".repeat(21) },
      { notes: "a\u0007b" },
    ]) {
      expect(planSetInputSchema.safeParse(bad).success, JSON.stringify(bad)).toBe(false);
    }
  });
});

describe("a plan from a template (brief §7.2)", () => {
  const model = (stageId: string, goal: string) => ({
    stageId,
    sessions: [{ week: null, number: null, goal, items: [{ exerciseId: id, sets: [{ reps: 8 }] }] }],
  });

  it("makes the weeks and sessions of each stage as copies of the template's session", () => {
    const stages = expandTemplate([model("a", "Rehab"), model("b", "Strength")], 2, 3);

    expect(stages.map((stage) => stage.sessions.length)).toEqual([6, 6]);
    expect(stages[0]!.sessions.map((session) => [session.week, session.number])).toEqual([
      [1, 1],
      [1, 2],
      [1, 3],
      [2, 1],
      [2, 2],
      [2, 3],
    ]);
    expect(stages[1]!.sessions[0]).toMatchObject({ goal: "Strength", items: [{ exerciseId: id }] });
    // Copies, not the same objects: editing one session does not change the others.
    stages[0]!.sessions[0]!.items[0]!.sets[0]!.reps = 12;
    expect(stages[0]!.sessions[1]!.items[0]!.sets[0]!.reps).toBe(8);
  });

  it("numbers the weeks through the whole plan, not per stage", () => {
    const numbered = numberWeeksAcrossStages(expandTemplate([model("a", "x"), model("b", "y")], 4, 3));

    expect(numbered[0]!.sessions.at(-1)!.week).toBe(4);
    expect(numbered[1]!.sessions[0]!.week).toBe(5);
    expect(numbered[1]!.sessions.at(-1)!.week).toBe(8);
    expect(plannedSessions(numbered)).toBe(24);
  });

  it("makes an empty stage for a template stage that has no session", () => {
    const stages = expandTemplate([{ stageId: "a", sessions: [] }], 1, 2);
    expect(stages[0]!.sessions).toEqual([
      { week: 1, number: 1, goal: null, items: [] },
      { week: 1, number: 2, goal: null, items: [] },
    ]);
  });
});

describe("the plan inputs", () => {
  it("take a whole plan with its stages, sessions, exercises and sets", () => {
    const parsed = planContentSchema.parse({
      name: "Giáo án 12 tuần",
      goal: "Giảm mỡ",
      stages: [
        {
          stageId: id,
          sessions: [
            { week: "1", number: "1", goal: "", items: [{ exerciseId: id, sets: [{ weight: "40", reps: "10" }, {}] }] },
          ],
        },
      ],
    });
    expect(parsed.stages[0]!.sessions[0]).toMatchObject({ week: 1, number: 1, goal: null });
    expect(parsed.stages[0]!.sessions[0]!.items[0]!.sets).toHaveLength(2);
    expect(planContentSchema.safeParse({ name: " ", stages: [] }).success).toBe(false);
    expect(planContentSchema.safeParse({ name: "x", stages: [{ stageId: "nope", sessions: [] }] }).success).toBe(false);
  });

  it("refuse more than the limits", () => {
    const sets = Array.from({ length: 13 }, () => ({}));
    expect(
      planContentSchema.safeParse({
        name: "x",
        stages: [{ stageId: id, sessions: [{ week: 1, number: 1, items: [{ exerciseId: id, sets }] }] }],
      }).success,
    ).toBe(false);
    expect(
      planContentSchema.safeParse({
        name: "x",
        stages: Array.from({ length: 13 }, () => ({ stageId: id, sessions: [] })),
      }).success,
    ).toBe(false);
  });

  it("create a template, or a customer's plan blank or from a template", () => {
    expect(planCreateSchema.parse({ kind: "TEMPLATE", name: "Rehab lưng", branchId: "" })).toMatchObject({
      kind: "TEMPLATE",
    });
    const plan = planCreateSchema.parse({ kind: "CUSTOMER", customerId: id, contractId: id });
    expect(plan).toMatchObject({ trainerId: null, templateId: null, weeksPerStage: 4, sessionsPerWeek: 3, name: null });
    expect(
      planCreateSchema.safeParse({ kind: "CUSTOMER", customerId: id, contractId: id, weeksPerStage: 27 }).success,
    ).toBe(false);
    expect(
      planCreateSchema.safeParse({ kind: "CUSTOMER", customerId: id, contractId: id, sessionsPerWeek: 8 }).success,
    ).toBe(false);
    expect(planCreateSchema.safeParse({ kind: "CUSTOMER", contractId: id }).success).toBe(false);
    expect(planCreateSchema.safeParse({ kind: "OTHER" }).success).toBe(false);
  });

  it("page the list and treat empty filters as not asked", () => {
    expect(planListQuerySchema.parse({ kind: "", status: "", customerId: "" })).toMatchObject({
      page: 1,
      pageSize: 20,
    });
    expect(planListQuerySchema.safeParse({ status: "DONE" }).success).toBe(false);
  });
});
