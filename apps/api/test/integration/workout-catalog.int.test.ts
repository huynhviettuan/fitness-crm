import { afterEach, describe, expect, it } from "vitest";
import { WORKOUT_CODES, MAX_AREA_DEPTH } from "@flow/shared/workouts";
import { prisma } from "../../src/platform/db/prisma.js";
import { listOptions } from "../../src/platform/options/option.service.js";
import {
  createArea,
  createEquipment,
  createExercise,
  createStage,
  getExercise,
  listAreas,
  listEquipment,
  listExercises,
  listStages,
  updateArea,
  updateEquipment,
  updateExercise,
  updateStage,
} from "../../src/modules/workouts/catalog.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser, type RoleCode } from "../support/factories.js";

afterEach(resetDatabase);

// The workout catalogs and the log's option lists (M7.1; brief §7.1, §7.3; FR-WKO-001; D-033; A-188 to A-191).

async function admin() {
  return (await createTestUser("ADMIN", { allBranches: true })).actor;
}
const equipmentInput = (code: string, name: string, extra: Record<string, unknown> = {}) => ({ code, name, ...extra });
const areaInput = (code: string, name: string, parentId: string | null = null) => ({ code, name, parentId });

async function tree(actor: Awaited<ReturnType<typeof admin>>) {
  const lower = await createArea(actor, areaInput("LOWER", "Thân dưới"));
  const thigh = await createArea(actor, areaInput("THIGH", "Đùi", lower.id));
  const quad = await createArea(actor, areaInput("QUAD", "Đùi trước", thigh.id));
  const upper = await createArea(actor, areaInput("UPPER", "Thân trên"));
  return { lower, thigh, quad, upper };
}

describe("the option lists of the log (brief §7.3)", () => {
  it("start with the brief's values, in order, with the codes the log relies on, and one Khác each", async () => {
    const labels = async (key: Parameters<typeof listOptions>[0]) =>
      (await listOptions(key, { includeInactive: true })).map((option) => option.labelVi);

    expect(await labels("workoutFlags")).toEqual(["Normal", "Stress", "Overload", "Pattern", "Spike/Neuro", "Khác"]);
    expect(await labels("workoutActions")).toEqual([
      "None",
      "Theo dõi thêm",
      "Giảm tải",
      "Tăng tải",
      "Đổi bài",
      "Dừng + Escalation",
      "Khác",
    ]);
    expect(await labels("sessionImpacts")).toEqual(["Thấp", "Trung bình", "Cao", "Không ảnh hưởng", "Khác"]);
    expect(await labels("sessionSummaries")).toEqual(["Không thay đổi", "Tốt hơn", "Tệ hơn", "Khác"]);
    const flags = await listOptions("workoutFlags", { includeInactive: true });
    const actions = await listOptions("workoutActions", { includeInactive: true });
    expect(flags.find((option) => option.code === WORKOUT_CODES.flagNormal)?.labelVi).toBe("Normal");
    expect(actions.find((option) => option.code === WORKOUT_CODES.actionNone)?.labelVi).toBe("None");
    expect(actions.find((option) => option.code === WORKOUT_CODES.actionStopEscalation)?.labelEn).toBe(
      "Stop + Escalation",
    );
    expect(flags.filter((option) => option.isOther)).toHaveLength(1);
  });
});

describe("equipment", () => {
  it("is added with a code in capitals, edited, and made inactive instead of deleted, all audited", async () => {
    const actor = await admin();

    const barbell = await createEquipment(actor, equipmentInput(" bb-01 ", "Barbell", { notes: "20 kg" }));
    expect(barbell).toMatchObject({ code: "BB-01", name: "Barbell", notes: "20 kg", active: true, exercises: 0 });

    const renamed = await updateEquipment(
      actor,
      barbell.id,
      equipmentInput("BB-01", "Olympic barbell", { active: false }),
    );
    expect(renamed).toMatchObject({ name: "Olympic barbell", active: false });
    expect((await listEquipment(actor, {})).items).toHaveLength(0);
    expect((await listEquipment(actor, { includeInactive: "true" })).items).toHaveLength(1);

    const events = await prisma.auditEvent.findMany({ where: { entityId: barbell.id }, orderBy: { createdAt: "asc" } });
    expect(events.map((event) => event.action)).toEqual(["workout_equipment.created", "workout_equipment.updated"]);
    expect(events[1]).toMatchObject({
      before: { name: "Barbell", active: true },
      after: { name: "Olympic barbell", active: false },
    });
  });

  it("refuses a code or a name that exists, whatever the capitals, also for two requests at once", async () => {
    const actor = await admin();
    const first = await createEquipment(actor, equipmentInput("DB", "Dumbbell"));

    await expect(createEquipment(actor, equipmentInput("db", "Other"))).rejects.toMatchObject({
      fieldErrors: { code: ["duplicate"] },
    });
    await expect(createEquipment(actor, equipmentInput("DB2", "DUMBBELL"))).rejects.toMatchObject({
      fieldErrors: { name: ["duplicate"] },
    });
    // Saving an entry with its own code and name is not a clash.
    await expect(
      updateEquipment(actor, first.id, equipmentInput("DB", "Dumbbell", { notes: "pair" })),
    ).resolves.toBeDefined();

    const results = await Promise.allSettled(
      Array.from({ length: 5 }, () => createEquipment(actor, equipmentInput("KB", "Kettlebell"))),
    );
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    for (const result of results) {
      if (result.status === "rejected") expect(result.reason).toMatchObject({ code: "VALIDATION_FAILED" });
    }
  });
});

describe("the body-area tree", () => {
  it("lists areas in reading order with their path and depth", async () => {
    const actor = await admin();
    const { quad } = await tree(actor);

    const { items } = await listAreas(actor, {});

    expect(items.map((area) => area.name)).toEqual(["Thân dưới", "Đùi", "Đùi trước", "Thân trên"]);
    expect(items.find((area) => area.id === quad.id)).toMatchObject({
      path: "Thân dưới › Đùi › Đùi trước",
      depth: 3,
    });
  });

  it("refuses an area under itself or under what is below it, and a tree that is too deep", async () => {
    const actor = await admin();
    const { lower, thigh, quad, upper } = await tree(actor);

    await expect(updateArea(actor, lower.id, areaInput("LOWER", "Thân dưới", quad.id))).rejects.toMatchObject({
      fieldErrors: { parentId: ["cycle"] },
    });
    await expect(updateArea(actor, lower.id, areaInput("LOWER", "Thân dưới", lower.id))).rejects.toMatchObject({
      fieldErrors: { parentId: ["cycle"] },
    });
    await expect(
      createArea(actor, areaInput("X", "Không có cha", "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11")),
    ).rejects.toMatchObject({
      fieldErrors: { parentId: ["invalidChoice"] },
    });

    let parent = upper.id;
    for (let level = 2; level <= MAX_AREA_DEPTH; level++) {
      parent = (await createArea(actor, areaInput(`L${level}`, `Cấp ${level}`, parent))).id;
    }
    await expect(createArea(actor, areaInput("DEEP", "Quá sâu", parent))).rejects.toMatchObject({
      fieldErrors: { parentId: ["tooDeep"] },
    });
    // Moving a whole branch under the deepest area would make it too deep too.
    await expect(updateArea(actor, thigh.id, areaInput("THIGH", "Đùi", parent))).rejects.toMatchObject({
      fieldErrors: { parentId: ["tooDeep"] },
    });
  });

  it("moves a branch, and two moves at once never make a loop", async () => {
    const actor = await admin();
    const a = await createArea(actor, areaInput("A", "A"));
    const b = await createArea(actor, areaInput("B", "B"));

    const results = await Promise.allSettled([
      updateArea(actor, a.id, areaInput("A", "A", b.id)),
      updateArea(actor, b.id, areaInput("B", "B", a.id)),
    ]);

    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    const rows = await prisma.workoutArea.findMany();
    expect(rows.filter((row) => row.parentId !== null)).toHaveLength(1);
  });

  it("allows a name once among siblings but again under another parent", async () => {
    const actor = await admin();
    const { lower, upper } = await tree(actor);
    await createArea(actor, areaInput("L-CORE", "Core", lower.id));

    await expect(createArea(actor, areaInput("L-CORE2", "core", lower.id))).rejects.toMatchObject({
      fieldErrors: { name: ["duplicate"] },
    });
    await expect(createArea(actor, areaInput("U-CORE", "Core", upper.id))).resolves.toMatchObject({ name: "Core" });
    await expect(createArea(actor, areaInput("LOWER", "Mã trùng"))).rejects.toMatchObject({
      fieldErrors: { code: ["duplicate"] },
    });
  });
});

describe("exercises", () => {
  async function stocked() {
    const actor = await admin();
    const { lower, thigh, quad, upper } = await tree(actor);
    const barbell = await createEquipment(actor, equipmentInput("BB", "Barbell"));
    const squat = await createExercise(actor, {
      name: "Back squat",
      areaId: quad.id,
      equipmentId: barbell.id,
      kind: "STRENGTH",
      videoUrl: "https://video.example.test/squat",
    });
    const run = await createExercise(actor, { name: "Chạy bộ", areaId: lower.id, kind: "CARDIO" });
    const press = await createExercise(actor, {
      name: "Đẩy tạ",
      areaId: upper.id,
      equipmentId: barbell.id,
      kind: "STRENGTH",
    });
    return { actor, lower, thigh, quad, upper, barbell, squat, run, press };
  }

  it("is a Strength or Cardio exercise with an area, optional equipment and a video link", async () => {
    const { actor, squat, run, quad, barbell } = await stocked();

    expect(squat).toMatchObject({
      name: "Back squat",
      kind: "STRENGTH",
      area: { id: quad.id, path: "Thân dưới › Đùi › Đùi trước" },
      equipment: { id: barbell.id, name: "Barbell" },
      videoUrl: "https://video.example.test/squat",
      active: true,
    });
    expect(run).toMatchObject({ kind: "CARDIO", equipment: null, videoUrl: null });
    expect((await getExercise(actor, squat.id)).id).toBe(squat.id);
    expect((await listEquipment(actor, {})).items[0]).toMatchObject({ exercises: 2 });
  });

  it("searches ignoring capitals and diacritics, and filters by area (with everything below it), equipment and kind", async () => {
    const { actor, lower, quad, barbell } = await stocked();
    const names = async (query: Record<string, string>) =>
      (await listExercises(actor, query)).items.map((item) => item.name);

    expect(await names({ q: "day ta" })).toEqual(["Đẩy tạ"]);
    expect(await names({ q: "CHAY" })).toEqual(["Chạy bộ"]);
    expect(await names({ areaId: lower.id })).toEqual(["Back squat", "Chạy bộ"]);
    expect(await names({ areaId: quad.id })).toEqual(["Back squat"]);
    expect(await names({ equipmentId: barbell.id })).toEqual(["Back squat", "Đẩy tạ"]);
    expect(await names({ kind: "CARDIO" })).toEqual(["Chạy bộ"]);
    expect(await names({ areaId: "", kind: "", q: "" })).toHaveLength(3);
    const page = await listExercises(actor, { pageSize: "2", page: "2" });
    expect([page.items.length, page.total]).toEqual([1, 3]);
  });

  it("keeps an inactive exercise out of the default list, and an inactive area or equipment out of new ones", async () => {
    const { actor, squat, quad, thigh, barbell } = await stocked();

    await updateExercise(actor, squat.id, {
      name: squat.name,
      areaId: quad.id,
      equipmentId: barbell.id,
      kind: "STRENGTH",
      active: false,
    });
    expect((await listExercises(actor, {})).total).toBe(2);
    expect((await listExercises(actor, { includeInactive: "true" })).total).toBe(3);

    await updateArea(actor, thigh.id, {
      code: "THIGH",
      name: "Đùi",
      parentId: (await prisma.workoutArea.findUniqueOrThrow({ where: { id: thigh.id } })).parentId,
      active: false,
    });
    await updateArea(actor, quad.id, { code: "QUAD", name: "Đùi trước", parentId: thigh.id, active: false });
    await updateEquipment(actor, barbell.id, equipmentInput("BB", "Barbell", { active: false }));
    // New exercises cannot use them...
    await expect(createExercise(actor, { name: "Mới", areaId: quad.id, kind: "STRENGTH" })).rejects.toMatchObject({
      fieldErrors: { areaId: ["invalidChoice"] },
    });
    // ...but an exercise that already has them keeps them when it is edited.
    await expect(
      updateExercise(actor, squat.id, {
        name: "Back squat 2",
        areaId: quad.id,
        equipmentId: barbell.id,
        kind: "STRENGTH",
        active: false,
      }),
    ).resolves.toMatchObject({ name: "Back squat 2" });
  });

  it("refuses a name that exists, a missing area or equipment, and a video that is not https", async () => {
    const { actor, quad, squat, barbell } = await stocked();
    const base = { areaId: quad.id, kind: "STRENGTH" };

    await expect(createExercise(actor, { ...base, name: "back SQUAT" })).rejects.toMatchObject({
      fieldErrors: { name: ["duplicate"] },
    });
    await expect(
      createExercise(actor, { ...base, name: "Mới", areaId: "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11" }),
    ).rejects.toMatchObject({
      fieldErrors: { areaId: ["invalidChoice"] },
    });
    await expect(
      createExercise(actor, { ...base, name: "Mới", equipmentId: "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11" }),
    ).rejects.toMatchObject({ fieldErrors: { equipmentId: ["invalidChoice"] } });
    for (const videoUrl of ["http://video.example.test/x", "javascript:alert(1)", "ftp://x/y"]) {
      await expect(createExercise(actor, { ...base, name: "Mới", videoUrl })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
      });
    }
    // The exercise's own name is not a clash when it is saved again.
    await expect(
      updateExercise(actor, squat.id, { ...base, name: "back squat", equipmentId: barbell.id }),
    ).resolves.toMatchObject({ name: "back squat" });
    await expect(getExercise(actor, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("stages", () => {
  it("are added, edited and made inactive, with unique names", async () => {
    const actor = await admin();

    const rehab = await createStage(actor, { name: "Rehab", description: "Phục hồi chức năng" });
    await expect(createStage(actor, { name: "rehab" })).rejects.toMatchObject({ fieldErrors: { name: ["duplicate"] } });
    const hidden = await updateStage(actor, rehab.id, { name: "Rehab", description: "", active: false });

    expect(hidden).toMatchObject({ description: null, active: false });
    expect((await listStages(actor, {})).items).toHaveLength(0);
    expect((await listStages(actor, { includeInactive: "true" })).items).toHaveLength(1);
    await expect(updateStage(actor, "3f2b8a64-5d1e-4c1b-9a7e-0b6f6f0c1a11", { name: "X" })).rejects.toMatchObject({
      code: "NOT_FOUND",
    });
  });
});

describe("who may see and keep the catalogs", () => {
  it("is seen by admin, the manager, the Master and the PT, and kept by admin and the manager", async () => {
    const owner = await admin();
    const area = await createArea(owner, areaInput("A", "A"));

    for (const role of ["ADMIN", "FITNESS_MANAGER", "MASTER", "PT"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      expect((await listAreas(actor, {})).items).toHaveLength(1);
      expect((await listEquipment(actor, {})).items).toHaveLength(0);
      expect((await listExercises(actor, {})).total).toBe(0);
      expect((await listStages(actor, {})).items).toHaveLength(0);
    }
    for (const role of ["MASTER", "PT", "RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(createEquipment(actor, equipmentInput("X", "X"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(updateArea(actor, area.id, areaInput("A", "A"))).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createStage(actor, { name: "X" })).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(createExercise(actor, { name: "X", areaId: area.id, kind: "STRENGTH" })).rejects.toMatchObject({
        code: "FORBIDDEN",
      });
    }
    for (const role of ["RECEPTIONIST", "CONSULTING", "ACCOUNTANT", "MARKETING"] as RoleCode[]) {
      const { actor } = await createTestUser(role);
      await expect(listAreas(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(listExercises(actor, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    }
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    await expect(createEquipment(manager, equipmentInput("M", "Máy"))).resolves.toBeDefined();
  });

  it("refuses bad ids and inputs with a field error, never a server error", async () => {
    const actor = await admin();

    await expect(updateEquipment(actor, "nope", equipmentInput("A", "A"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(createEquipment(actor, { code: "bad code", name: "x" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(createEquipment(actor, { code: "OK", name: "a\u0007b" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(createEquipment(actor, { code: "OK", name: "x".repeat(101) })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
    });
    await expect(listExercises(actor, { kind: "YOGA" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    await expect(listExercises(actor, { pageSize: "101" })).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});
