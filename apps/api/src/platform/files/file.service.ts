import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  FILE_LINK_SECONDS,
  MAX_FILE_BYTES,
  detectImageType,
  uploadQuerySchema,
  type FileLink,
  type FilePurpose,
  type StoredFileView,
} from "@flow/shared/files";
import type { Permission } from "@flow/shared/permissions";
import { prisma, type Db } from "../db/prisma.js";
import { env } from "../env.js";
import { AppError } from "../errors/app-error.js";
import type { Actor } from "../auth/session.js";
import { recordAudit } from "../audit/audit.repository.js";
import { assertCan, forbidden } from "../permissions/assert.js";
import { parseInput } from "../validation/parse.js";
import { fileStorage } from "./file.storage.js";

// Private files (T-052, D-042, M4.1b; A-143, A-144). The bytes are in the storage; a client gets a link signed for
// the signed-in user, valid for a few minutes, and the file is served only to someone who may see what it is
// attached to. An unattached file is its uploader's alone.

/** Who may upload and who may see each purpose of file. */
const PERMISSIONS: Record<FilePurpose, { upload: Permission; view: Permission }> = {
  service_image: { upload: "service.manage", view: "service.view" },
  receipt_proof: { upload: "payment.record", view: "payment.view" },
};

const EXTENSION = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" } as const;

/** Stores an uploaded picture and records it (not yet attached to anything). */
export async function uploadFile(actor: Actor, rawQuery: unknown, body: unknown): Promise<StoredFileView> {
  const { purpose } = parseInput(uploadQuerySchema, rawQuery);
  assertCan(actor, PERMISSIONS[purpose].upload);
  if (!Buffer.isBuffer(body) || body.length === 0) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { file: ["required"] } });
  }
  if (body.length > MAX_FILE_BYTES)
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { file: ["fileTooLarge"] } });
  const contentType = detectImageType(body);
  if (!contentType) throw new AppError("VALIDATION_FAILED", { fieldErrors: { file: ["notAnImage"] } });

  const id = randomUUID();
  const storageKey = `${purpose}/${id}.${EXTENSION[contentType]}`;
  await fileStorage.put(storageKey, body, contentType);
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.storedFile.create({
      data: {
        id,
        purpose,
        contentType,
        size: body.length,
        sha256: createHash("sha256").update(body).digest("hex"),
        storageKey,
        uploadedById: actor.id,
      },
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "file",
      entityId: id,
      action: "file.uploaded",
      after: { purpose, contentType, size: body.length },
    });
    return created;
  });
  return { id: row.id, purpose, contentType, size: row.size, createdAt: row.createdAt };
}

/**
 * Checks `actor` may attach this file as a `purpose` picture: it exists, was uploaded for that purpose by them, and
 * is not attached anywhere else. Called inside the transaction that attaches it.
 */
export async function claimFile(db: Db, actor: Actor, fileId: string, purpose: FilePurpose, current: string | null) {
  if (fileId === current) return;
  const file = await db.storedFile.findUnique({
    where: { id: fileId },
    select: { purpose: true, uploadedById: true, _count: { select: { serviceImages: true, paymentProofs: true } } },
  });
  if (!file || file.purpose !== purpose || file.uploadedById !== actor.id) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { fileId: ["invalidChoice"] } });
  }
  if (file._count.serviceImages + file._count.paymentProofs > 0) {
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { fileId: ["fileInUse"] } });
  }
}

function signature(id: string, userId: string, expires: number): string {
  return createHmac("sha256", env.BETTER_AUTH_SECRET).update(`file:${id}:${userId}:${expires}`).digest("hex");
}

/**
 * Who may see the file: an unattached file only its uploader; an attached one whoever has the purpose's view
 * permission (a receipt's proof also needs the receipt in their branches and scope).
 */
async function assertMaySee(actor: Actor, file: { id: string; purpose: string; uploadedById: string }) {
  const purpose = file.purpose as FilePurpose;
  assertCan(actor, PERMISSIONS[purpose].view);
  const attached =
    purpose === "service_image"
      ? await prisma.service.count({ where: { imageFileId: file.id } })
      : await prisma.payment.count({ where: { proofFileId: file.id, deletedAt: null } });
  if (attached === 0) {
    if (file.uploadedById !== actor.id) throw new AppError("NOT_FOUND");
    return;
  }
  if (purpose === "receipt_proof") {
    const { paymentsVisibleTo } = await import("../../modules/finance/payment.service.js");
    const visible = await prisma.payment.count({
      where: { AND: [{ proofFileId: file.id }, paymentsVisibleTo(actor)] },
    });
    if (visible === 0) throw new AppError("NOT_FOUND");
  }
}

async function findFile(id: string) {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const file = await prisma.storedFile.findUnique({ where: { id } });
  if (!file) throw new AppError("NOT_FOUND");
  return file;
}

/** A signed link for the signed-in user to fetch the file's bytes through the API, valid for a few minutes. */
export async function fileLink(actor: Actor, id: string): Promise<FileLink> {
  const file = await findFile(id);
  await assertMaySee(actor, file);
  const expires = Math.floor(Date.now() / 1000) + FILE_LINK_SECONDS;
  return {
    url: `/api/v1/files/${file.id}/content?expires=${expires}&signature=${signature(file.id, actor.id, expires)}`,
    expiresAt: new Date(expires * 1000),
  };
}

/** The bytes, for a link made for this user that has not expired. A wrong or old link is the same NOT_FOUND. */
export async function fileContent(
  actor: Actor,
  id: string,
  query: { expires?: string; signature?: string },
): Promise<{ bytes: Buffer; contentType: string }> {
  const file = await findFile(id);
  const expires = Number(query.expires);
  const expected = Buffer.from(signature(file.id, actor.id, expires), "hex");
  const given = Buffer.from(/^[0-9a-f]{64}$/.test(query.signature ?? "") ? query.signature! : "", "hex");
  if (
    !Number.isInteger(expires) ||
    expires < Date.now() / 1000 ||
    given.length !== expected.length ||
    !timingSafeEqual(given, expected)
  ) {
    throw forbidden(actor, PERMISSIONS[file.purpose as FilePurpose].view, "badFileLink");
  }
  await assertMaySee(actor, file);
  return { bytes: await fileStorage.get(file.storageKey), contentType: file.contentType };
}
