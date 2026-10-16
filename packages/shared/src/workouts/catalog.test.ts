import { describe, expect, it } from "vitest";
import {
  areaInputSchema,
  areaPath,
  depthOf,
  descendantIds,
  equipmentInputSchema,
  exerciseInputSchema,
  exerciseListQuerySchema,
  heightOf,
  stageInputSchema,
  wouldCycle,
} from "./index.js";

// A small tree: lower > thigh > quad, lower > calf, upper.
const areas = [
  { id: "lower", parentId: null, name: "Thân dưới" },
  { id: "thigh", parentId: "lower", name: "Đùi" },
  { id: "quad", parentId: "thigh", name: "Đùi trước" },
  { id: "calf", parentId: "lower", name: "Bắp chân" },
  { id: "upper", parentId: null, name: "Thân trên" },
];

describe("the body-area tree (brief §7.1)", () => {
  it("finds everything below an area, at any depth", () => {
    expect(descendantIds(areas, "lower").sort()).toEqual(["calf", "quad", "thigh"]);
    expect(descendantIds(areas, "quad")).toEqual([]);
  });

  it("refuses to move an area under itself or under what is below it", () => {
    expect(wouldCycle(areas, "lower", "quad")).toBe(true);
    expect(wouldCycle(areas, "lower", "lower")).toBe(true);
    expect(wouldCycle(areas, "thigh", "calf")).toBe(false);
    expect(wouldCycle(areas, "quad", null)).toBe(false);
  });

  it("counts the levels above and below", () => {
    expect(depthOf(areas, "lower")).toBe(1);
    expect(depthOf(areas, "quad")).toBe(3);
    expect(heightOf(areas, "lower")).toBe(2);
    expect(heightOf(areas, "upper")).toBe(0);
  });

  it("names an area by its path", () => {
    expect(areaPath(areas, "quad")).toBe("Thân dưới › Đùi › Đùi trước");
    expect(areaPath(areas, "upper")).toBe("Thân trên");
  });

  it("does not loop on bad data", () => {
    const loop = [
      { id: "a", parentId: "b", name: "A" },
      { id: "b", parentId: "a", name: "B" },
    ];
    expect(depthOf(loop, "a")).toBe(2);
    expect(areaPath(loop, "a")).toBe("B › A");
  });
});

describe("the catalog inputs", () => {
  const id = "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11";

  it("keep a code in capitals and refuse odd characters", () => {
    expect(equipmentInputSchema.parse({ code: " bb-01 ", name: "Barbell" })).toMatchObject({
      code: "BB-01",
      active: true,
    });
    expect(equipmentInputSchema.safeParse({ code: "a b", name: "x" }).success).toBe(false);
    expect(equipmentInputSchema.safeParse({ code: "", name: "x" }).success).toBe(false);
    expect(equipmentInputSchema.safeParse({ code: "A".repeat(21), name: "x" }).success).toBe(false);
  });

  it("take an area with or without a parent", () => {
    expect(areaInputSchema.parse({ code: "LOW", name: "Thân dưới" }).parentId).toBeNull();
    expect(areaInputSchema.parse({ code: "THI", name: "Đùi", parentId: id }).parentId).toBe(id);
    expect(areaInputSchema.safeParse({ code: "X", name: "x", parentId: "nope" }).success).toBe(false);
  });

  it("take an exercise of a kind in an area, and only an https video", () => {
    const base = { name: "Squat", areaId: id, kind: "STRENGTH" };
    expect(exerciseInputSchema.parse(base)).toMatchObject({ equipmentId: null, videoUrl: null, description: null });
    expect(exerciseInputSchema.parse({ ...base, videoUrl: "https://video.example.test/squat" }).videoUrl).toBe(
      "https://video.example.test/squat",
    );
    expect(exerciseInputSchema.safeParse({ ...base, videoUrl: "http://video.example.test/x" }).success).toBe(false);
    expect(exerciseInputSchema.safeParse({ ...base, videoUrl: "javascript:alert(1)" }).success).toBe(false);
    expect(exerciseInputSchema.safeParse({ ...base, kind: "YOGA" }).success).toBe(false);
    expect(exerciseInputSchema.safeParse({ ...base, name: "a\u0007b" }).success).toBe(false);
    expect(exerciseInputSchema.safeParse({ ...base, areaId: "" }).success).toBe(false);
  });

  it("take a stage", () => {
    expect(stageInputSchema.parse({ name: "Rehab" })).toMatchObject({ description: null, active: true });
    expect(stageInputSchema.safeParse({ name: " " }).success).toBe(false);
  });

  it("page the exercises and treat empty filters as not asked", () => {
    expect(exerciseListQuerySchema.parse({ areaId: "", kind: "", q: "" })).toMatchObject({
      page: 1,
      pageSize: 20,
      q: "",
    });
    expect(exerciseListQuerySchema.safeParse({ kind: "YOGA" }).success).toBe(false);
    expect(exerciseListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
