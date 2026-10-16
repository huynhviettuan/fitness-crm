import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import { createScript, listScripts, reorderScripts, updateScript } from "../../src/modules/scripts/script.service.js";
import { resetDatabase } from "../support/database.js";
import { SEEDED_SCRIPTS, createTestUser } from "../support/factories.js";

// The consulting script library (brief §4.1, FR-LEAD-010, A-072).

afterEach(resetDatabase);

const input = (situationVi: string, extra: Record<string, unknown> = {}) => ({
  situationVi,
  situationEn: `${situationVi} (EN)`,
  ...extra,
});

describe("the library", () => {
  it("starts with the 12 situations of the brief, in order, with no answers", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const scripts = await listScripts(manager, { includeInactive: "true" });

    expect(scripts.map((script) => script.situationVi)).toEqual(SEEDED_SCRIPTS.map((script) => script.situationVi));
    expect(scripts.every((script) => script.active && script.answerVi === null && script.answerEn === null)).toBe(true);
  });

  it("lets a manager add, edit, deactivate, and reorder scripts, audited and never deleted", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const created = await createScript(
      manager,
      input("Giá PT", { answerVi: "Gói 12 buổi giá 6.500.000đ.", answerEn: "" }),
    );
    expect(created).toMatchObject({ situationVi: "Giá PT", answerEn: null, active: true, sortOrder: 13 });

    const edited = await updateScript(manager, created.id, {
      ...input("Giá PT", { answerEn: "12 sessions for 6,500,000 VND." }),
      answerVi: "Gói 12 buổi giá 6.500.000đ.",
      active: false,
    });
    expect(edited).toMatchObject({ answerEn: "12 sessions for 6,500,000 VND.", active: false });
    expect(await prisma.consultingScript.count()).toBe(13);

    const all = await listScripts(manager, { includeInactive: "true" });
    const reversed = all.map((script) => script.id).reverse();
    const reordered = await reorderScripts(manager, { scriptIds: reversed });
    expect(reordered.map((script) => script.id)).toEqual(reversed);

    const actions = (await prisma.auditEvent.findMany({ where: { entityType: "consulting_script" } })).map(
      (event) => event.action,
    );
    expect(actions).toContain("consulting_script.created");
    expect(actions).toContain("consulting_script.updated");
    expect(actions).toContain("consulting_script.reordered");
    const update = await prisma.auditEvent.findFirstOrThrow({
      where: { entityId: created.id, action: "consulting_script.updated" },
    });
    expect(update.before).toMatchObject({ active: true });
    expect(update.after).toMatchObject({ active: false });
  });

  it("refuses an order that leaves a script out, repeats one, or names one that does not exist", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const ids = (await listScripts(manager, { includeInactive: "true" })).map((script) => script.id);

    for (const scriptIds of [ids.slice(1), [...ids.slice(1), ids[1]], [...ids.slice(1), randomUUID()]]) {
      await expect(reorderScripts(manager, { scriptIds })).rejects.toMatchObject({
        code: "VALIDATION_FAILED",
        fieldErrors: { scriptIds: ["invalidChoice"] },
      });
    }
  });

  it("rejects missing names, overlong or control-character text, and an unknown script", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(createScript(manager, { situationVi: "", situationEn: "" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { situationVi: ["required"], situationEn: ["required"] },
    });
    await expect(createScript(manager, input("A", { answerVi: "x".repeat(4001) }))).rejects.toMatchObject({
      fieldErrors: { answerVi: ["tooLong"] },
    });
    await expect(createScript(manager, input("A", { answerEn: "a\u0007b" }))).rejects.toMatchObject({
      fieldErrors: { answerEn: ["invalidCharacters"] },
    });
    await expect(updateScript(manager, randomUUID(), input("A"))).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(updateScript(manager, "not-a-uuid", input("A"))).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("who may read and manage", () => {
  it("gives a consultant only the active scripts that have an answer", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { actor: consultant } = await createTestUser("CONSULTING");
    await createScript(manager, input("Có đáp án", { answerVi: "Xin chào!", answerEn: "" }));
    const hidden = await createScript(manager, input("Đã tắt", { answerVi: "Không dùng", answerEn: "" }));
    await updateScript(manager, hidden.id, { ...input("Đã tắt"), answerVi: "Không dùng", active: false });

    const visible = await listScripts(consultant, {});

    expect(visible.map((script) => script.situationVi)).toEqual(["Có đáp án"]);
    expect(visible[0]).toMatchObject({ answerVi: "Xin chào!", answerEn: null });
  });

  it("refuses everything but reading to a consultant, and reading to someone who cannot see leads", async () => {
    const { actor: consultant } = await createTestUser("CONSULTING");
    const { actor: accountant } = await createTestUser("ACCOUNTANT");
    const [first] = SEEDED_SCRIPTS;

    await expect(listScripts(consultant, { includeInactive: "true" })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(createScript(consultant, input("X"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(updateScript(consultant, first.id, input("X"))).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(reorderScripts(consultant, { scriptIds: [first.id] })).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(listScripts(accountant, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    expect((await prisma.consultingScript.findUniqueOrThrow({ where: { id: first.id } })).situationVi).toBe(
      first.situationVi,
    );
  });

  it("is managed by Admin and Fitness Manager only, by default (A-072)", async () => {
    const holders = await prisma.rolePermission.findMany({
      where: { permission: "script.manage" },
      include: { role: true },
    });

    expect(holders.map((holder) => holder.role.code).sort()).toEqual(["ADMIN", "FITNESS_MANAGER"]);
  });
});
