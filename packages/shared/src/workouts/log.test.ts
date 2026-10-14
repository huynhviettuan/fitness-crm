import { describe, expect, it } from "vitest";
import {
  actualsOf,
  defaultActuals,
  foreignActuals,
  isEscalation,
  logContentSchema,
  logCreateSchema,
  logListQuerySchema,
  logSetInputSchema,
  nextPlannedSession,
} from "./index.js";

const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";
const other = "9a1c2d3e-4f50-4a6b-8c7d-1e2f3a4b5c6d";

describe("the actual of a set starts as the plan (brief §7.3, A-201)", () => {
  it("copies weight, reps and RIR for Strength, and time, speed and heart rate for Cardio", () => {
    const planned = {
      weight: 40,
      reps: 10,
      rir: 2,
      restSeconds: 60,
      durationMinutes: 15,
      speed: 8.5,
      heartRate: 140,
      notes: "x",
    };
    expect(defaultActuals("STRENGTH", planned)).toEqual({
      weight: 40,
      reps: 10,
      rir: 2,
      durationMinutes: null,
      speed: null,
      heartRate: null,
    });
    expect(defaultActuals("CARDIO", planned)).toEqual({
      weight: null,
      reps: null,
      rir: null,
      durationMinutes: 15,
      speed: 8.5,
      heartRate: 140,
    });
  });

  it("knows which fields belong to which kind", () => {
    expect(actualsOf("STRENGTH")).toEqual(["weight", "reps", "rir"]);
    expect(actualsOf("CARDIO")).toEqual(["durationMinutes", "speed", "heartRate"]);
    expect(foreignActuals("CARDIO", { weight: 40, speed: 8 })).toEqual(["weight"]);
    expect(foreignActuals("STRENGTH", { weight: 40, reps: null, speed: null })).toEqual([]);
  });
});

describe("the planned session a new log follows (A-200)", () => {
  const sessions = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("is the first not used yet, in the plan's order", () => {
    expect(nextPlannedSession(sessions, new Set())?.id).toBe("a");
    expect(nextPlannedSession(sessions, new Set(["a"]))?.id).toBe("b");
    expect(nextPlannedSession(sessions, new Set(["a", "c"]))?.id).toBe("b");
  });
  it("is none when every one is used or the plan has none", () => {
    expect(nextPlannedSession(sessions, new Set(["a", "b", "c"]))).toBeNull();
    expect(nextPlannedSession([], new Set())).toBeNull();
  });
});

describe("a log in the API", () => {
  it("ends the session with an escalation only for the Stop action", () => {
    expect(isEscalation("STOP_ESCALATION")).toBe(true);
    expect(isEscalation("NONE")).toBe(false);
    expect(isEscalation(null)).toBe(false);
  });

  it("takes the scales as 1 to 10 whole numbers, typed or not, and empty as nothing", () => {
    const base = { items: [] };
    const parse = (value: unknown) => logContentSchema.safeParse({ ...base, preStress: value });
    expect(parse("7").data?.preStress).toBe(7);
    expect(parse(7).data?.preStress).toBe(7);
    expect(parse("").data?.preStress).toBeNull();
    for (const bad of [0, 11, 5.5, "abc"]) expect(parse(bad).success, String(bad)).toBe(false);
  });

  it("needs a Flag and an Action on every set, and takes the numbers with a comma", () => {
    const set = { flagId: id, actionId: other };
    expect(logSetInputSchema.safeParse(set).success).toBe(true);
    expect(logSetInputSchema.safeParse({ actionId: other }).success).toBe(false);
    expect(logSetInputSchema.safeParse({ ...set, speed: "8,5" }).data?.speed).toBe(8.5);
    expect(logSetInputSchema.safeParse({ ...set, weight: -1 }).success).toBe(false);
    expect(logSetInputSchema.safeParse({ ...set, note: "a\u0007b" }).success).toBe(false);
  });

  it("opens from a booking, with a planned session only when named", () => {
    expect(logCreateSchema.safeParse({ bookingId: id }).data).toEqual({ bookingId: id, planSessionId: null });
    expect(logCreateSchema.safeParse({ bookingId: "nope" }).success).toBe(false);
    expect(logCreateSchema.safeParse({ bookingId: id, planSessionId: other }).data?.planSessionId).toBe(other);
  });

  it("lists with a paged query", () => {
    expect(logListQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 20 });
    expect(logListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(logListQuerySchema.safeParse({ customerId: "nope" }).success).toBe(false);
  });
});
