import { createHash, randomBytes } from "node:crypto";
import { deviceInputSchema, deviceUpdateSchema, isClockOff, type CheckinDevice } from "@flow/shared/checkin";
import type { Prisma } from "../../generated/prisma/client.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { readParameter } from "../../platform/parameters/parameter.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, resolveBranch } from "../../platform/permissions/scope.js";
import { parseInput } from "../../platform/validation/parse.js";

// The fingerprint machines (M5.3b, D-072). A machine belongs to one branch and has its own secret key; only the key's
// hash is stored, and the key is shown once, when it is made.

const deviceSelect = {
  id: true,
  name: true,
  active: true,
  lastSeenAt: true,
  clockOffsetSeconds: true,
  branch: { select: { id: true, name: true } },
} as const satisfies Prisma.CheckinDeviceSelect;

type DeviceRecord = Prisma.CheckinDeviceGetPayload<{ select: typeof deviceSelect }>;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** A key a machine puts in the `x-device-key` header: long, random, and recognisable in a leak scan. */
function newKey(): string {
  return `fcd_${randomBytes(32).toString("base64url")}`;
}

async function present(db: Db, device: DeviceRecord): Promise<CheckinDevice> {
  const tolerance = Number(await readParameter(db, "scanClockToleranceSeconds"));
  return { ...device, clockOff: isClockOff(device.clockOffsetSeconds, tolerance) };
}

export async function listDevices(actor: Actor): Promise<{ items: CheckinDevice[] }> {
  assertCan(actor, "checkin.devices");
  const devices = await prisma.checkinDevice.findMany({
    where: inBranches(actor),
    select: deviceSelect,
    orderBy: [{ name: "asc" }],
  });
  return { items: await Promise.all(devices.map((device) => present(prisma, device))) };
}

export async function createDevice(actor: Actor, input: unknown): Promise<{ device: CheckinDevice; key: string }> {
  assertCan(actor, "checkin.devices");
  const data = parseInput(deviceInputSchema, input);
  const key = newKey();
  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, data.branchId);
    const device = await tx.checkinDevice.create({
      data: { branchId, name: data.name, keyHash: hashKey(key) },
      select: deviceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "checkin_device",
      entityId: device.id,
      action: "checkin_device.created",
      after: { name: device.name, branchId },
    });
    return { device: await present(tx, device), key };
  });
}

export async function updateDevice(actor: Actor, id: string, input: unknown): Promise<CheckinDevice> {
  assertCan(actor, "checkin.devices");
  const data = parseInput(deviceUpdateSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await findVisible(tx, actor, id);
    const after = await tx.checkinDevice.update({ where: { id }, data, select: deviceSelect });
    const changes = diffFields(before, after, ["name", "active"]);
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "checkin_device",
        entityId: id,
        action: "checkin_device.updated",
        ...changes,
      });
    }
    return present(tx, after);
  });
}

/** A lost or leaked key is replaced; the old one stops working at once. */
export async function rotateDeviceKey(actor: Actor, id: string): Promise<{ device: CheckinDevice; key: string }> {
  assertCan(actor, "checkin.devices");
  const key = newKey();
  return prisma.$transaction(async (tx) => {
    await findVisible(tx, actor, id);
    const device = await tx.checkinDevice.update({
      where: { id },
      data: { keyHash: hashKey(key) },
      select: deviceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "checkin_device",
      entityId: id,
      action: "checkin_device.key_rotated",
    });
    return { device: await present(tx, device), key };
  });
}

async function findVisible(db: Db, actor: Actor, id: string): Promise<DeviceRecord> {
  const device = await db.checkinDevice.findFirst({ where: { id, ...inBranches(actor) }, select: deviceSelect });
  if (!device) throw new AppError("NOT_FOUND");
  return device;
}

/** The registered, active machine behind a key, or null (D-072: only a registered machine may send data). */
export async function authenticateDevice(key: string) {
  if (!/^fcd_[A-Za-z0-9_-]{20,100}$/.test(key)) return null;
  return prisma.checkinDevice.findFirst({
    where: { keyHash: hashKey(key), active: true },
    select: { id: true, branchId: true, name: true },
  });
}

export type AuthenticatedDevice = NonNullable<Awaited<ReturnType<typeof authenticateDevice>>>;

/** The machine a key belongs to, for the bridge's check (A-310): its name, its branch and the server's time. */
export async function describeDevice(device: AuthenticatedDevice) {
  const branch = await prisma.branch.findUniqueOrThrow({
    where: { id: device.branchId },
    select: { id: true, name: true },
  });
  return { id: device.id, name: device.name, branch, serverTime: new Date().toISOString() };
}
