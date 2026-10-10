import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "../../src/platform/db/prisma.js";
import {
  createTrainer,
  listTrainerLogins,
  listTrainers,
  trainerIdOfUser,
  updateTrainer,
} from "../../src/modules/trainers/trainer.service.js";
import { resetDatabase } from "../support/database.js";
import { createTestUser } from "../support/factories.js";

afterEach(async () => {
  await resetDatabase();
});

describe("createTrainer", () => {
  it("creates an ACTIVE trainer with a generated code and an audit event", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    const trainer = await createTrainer(manager, { fullName: "  Trần Minh  " });

    expect(trainer).toMatchObject({ trainerCode: expect.stringMatching(/^PT\d{3,}$/), fullName: "Trần Minh", status: "ACTIVE", user: null });
    const audit = await prisma.auditEvent.findMany({ where: { entityId: trainer.id } });
    expect(audit).toEqual([expect.objectContaining({ action: "trainer.created", actorUserId: manager.id })]);
  });

  it("gives trainers created at the same time different codes (T-019)", async () => {
    const { actor: admin } = await createTestUser("ADMIN");

    const trainers = await Promise.all(Array.from({ length: 5 }, (_, i) => createTrainer(admin, { fullName: `PT ${i}` })));

    expect(new Set(trainers.map((t) => t.trainerCode)).size).toBe(5);
  });

  it.each(["RECEPTIONIST", "PT", "ACCOUNTANT"] as const)("refuses a %s (A-016)", async (role) => {
    const { actor } = await createTestUser(role);

    await expect(createTrainer(actor, { fullName: "PT" })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("returns field errors for invalid input", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");

    await expect(createTrainer(manager, { fullName: " ", status: "RETIRED" })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { fullName: ["required"], status: ["invalidChoice"] },
    });
  });
});

describe("linking a login (A-010)", () => {
  it("links a TRAINER login, and the user resolves to that trainer", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");

    const trainer = await createTrainer(manager, { fullName: "PT Linh", userId: user.id });

    expect(trainer.user).toMatchObject({ id: user.id, email: user.email });
    expect(await trainerIdOfUser(user.id)).toBe(trainer.id);
    expect(await listTrainerLogins(manager)).toEqual([expect.objectContaining({ id: user.id, linkedTrainerId: trainer.id })]);
  });

  it("refuses a login without the TRAINER role", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("RECEPTIONIST");

    await expect(createTrainer(manager, { fullName: "PT", userId: user.id })).rejects.toMatchObject({
      code: "VALIDATION_FAILED",
      fieldErrors: { userId: ["userNotTrainer"] },
    });
  });

  it("refuses a login already linked to another trainer, even when both links arrive at once", async () => {
    const { actor: manager } = await createTestUser("FITNESS_MANAGER");
    const { user } = await createTestUser("PT");

    const results = await Promise.allSettled([
      createTrainer(manager, { fullName: "PT A", userId: user.id }),
      createTrainer(manager, { fullName: "PT B", userId: user.id }),
    ]);

    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(results.find((r) => r.status === "rejected")).toMatchObject({
      reason: { code: "VALIDATION_FAILED", fieldErrors: { userId: ["userAlreadyLinked"] } },
    });
  });
});

describe("updateTrainer", () => {
  it("audits the changed fields and can unlink the login", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("PT");
    const trainer = await createTrainer(admin, { fullName: "PT Linh", userId: user.id });

    const updated = await updateTrainer(admin, trainer.id, { fullName: "PT Linh", status: "INACTIVE", userId: "" });

    expect(updated).toMatchObject({ status: "INACTIVE", user: null });
    const audit = await prisma.auditEvent.findFirst({ where: { entityId: trainer.id, action: "trainer.updated" } });
    expect(audit?.metadata).toEqual({
      changes: { status: { from: "ACTIVE", to: "INACTIVE" }, userId: { from: user.id, to: null } },
    });
  });

  it("keeping a trainer's own login is not a conflict", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { user } = await createTestUser("PT");
    const trainer = await createTrainer(admin, { fullName: "PT Linh", userId: user.id });

    await expect(updateTrainer(admin, trainer.id, { fullName: "PT Linh Nguyễn", userId: user.id })).resolves.toMatchObject({
      fullName: "PT Linh Nguyễn",
    });
  });

  it("lists only active trainers when asked", async () => {
    const { actor: admin } = await createTestUser("ADMIN");
    const { actor: reception } = await createTestUser("RECEPTIONIST");
    const active = await createTrainer(admin, { fullName: "PT A" });
    const inactive = await createTrainer(admin, { fullName: "PT B" });
    await updateTrainer(admin, inactive.id, { fullName: "PT B", status: "INACTIVE" });

    expect((await listTrainers(reception, { activeOnly: "true" })).map((t) => t.id)).toEqual([active.id]);
    expect(await listTrainers(reception)).toHaveLength(2);
  });
});
