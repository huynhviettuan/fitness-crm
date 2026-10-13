import { randomUUID } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MAX_FILE_BYTES } from "@flow/shared/files";
import { prisma } from "../../src/platform/db/prisma.js";
import { fileContent, fileLink, uploadFile } from "../../src/platform/files/file.service.js";
import { createCustomer } from "../../src/modules/customers/customer.service.js";
import { recordPayment, setReceiptProof } from "../../src/modules/finance/payment.service.js";
import { createService, setServiceImage } from "../../src/modules/services/service.service.js";
import { resetDatabase } from "../support/database.js";
import {
  DEFAULT_BRANCH_ID,
  createTestBranch,
  createTestUser,
  optionId,
  withoutApprovals,
} from "../support/factories.js";
import { activeContract } from "../support/bookings.js";

afterEach(() => {
  vi.useRealTimers();
  return resetDatabase();
});
beforeEach(withoutApprovals);

const CASH = await optionId("paymentMethods", "Tiền mặt");

/** A few bytes that begin like a PNG: the type is read from them, not from the name. */
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from("picture")]);

const query = (purpose: string) => ({ purpose });
const queryOf = (link: string) => Object.fromEntries(new URL(link, "http://x").searchParams);

async function setup() {
  const { actor: admin } = await createTestUser("ADMIN", { allBranches: true });
  const { actor: manager } = await createTestUser("FITNESS_MANAGER");
  const { actor: reception } = await createTestUser("RECEPTIONIST");
  return { admin, manager, reception };
}

describe("uploading a picture (T-052, M4.1b)", () => {
  it("stores a picture by what its bytes are, for someone who may upload that purpose", async () => {
    const { admin } = await setup();

    const file = await uploadFile(admin, query("service_image"), PNG);

    expect(file).toMatchObject({ purpose: "service_image", contentType: "image/png", size: PNG.length });
    const row = await prisma.storedFile.findUniqueOrThrow({ where: { id: file.id } });
    expect(row.sha256).toHaveLength(64);
    expect(await prisma.auditEvent.count({ where: { entityId: file.id, action: "file.uploaded" } })).toBe(1);
  });

  it("refuses what is not a picture, an empty or oversize body, and a purpose the user may not upload", async () => {
    const { admin, manager } = await setup();

    await expect(
      uploadFile(admin, query("service_image"), Buffer.from("<svg onload=alert(1)/>")),
    ).rejects.toMatchObject({
      fieldErrors: { file: ["notAnImage"] },
    });
    await expect(uploadFile(admin, query("service_image"), Buffer.alloc(0))).rejects.toMatchObject({
      fieldErrors: { file: ["required"] },
    });
    await expect(uploadFile(admin, query("service_image"), undefined)).rejects.toMatchObject({
      fieldErrors: { file: ["required"] },
    });
    await expect(
      uploadFile(admin, query("service_image"), Buffer.concat([PNG, Buffer.alloc(MAX_FILE_BYTES)])),
    ).rejects.toMatchObject({ fieldErrors: { file: ["fileTooLarge"] } });
    await expect(uploadFile(admin, query("passport"), PNG)).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
    // A Fitness Manager records receipts but does not manage services.
    await expect(uploadFile(manager, query("service_image"), PNG)).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("a signed link (T-052)", () => {
  it("gives the bytes back to the user it was made for, until it expires", async () => {
    const { admin } = await setup();
    const file = await uploadFile(admin, query("service_image"), PNG);

    const link = await fileLink(admin, file.id);
    const served = await fileContent(admin, file.id, queryOf(link.url));

    expect(served.bytes.equals(PNG)).toBe(true);
    expect(served.contentType).toBe("image/png");
    vi.useFakeTimers({ now: link.expiresAt.getTime() + 1000, toFake: ["Date"] });
    await expect(fileContent(admin, file.id, queryOf(link.url))).rejects.toMatchObject({ code: "FORBIDDEN" });
  });

  it("is refused when changed, made for someone else, or missing", async () => {
    const { admin } = await setup();
    const { actor: otherAdmin } = await createTestUser("ADMIN", { allBranches: true });
    const file = await uploadFile(admin, query("service_image"), PNG);
    const given = queryOf((await fileLink(admin, file.id)).url);

    await expect(fileContent(otherAdmin, file.id, given)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      fileContent(admin, file.id, { ...given, expires: String(Number(given.expires) + 600) }),
    ).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(fileContent(admin, file.id, { ...given, signature: "0".repeat(64) })).rejects.toMatchObject({
      code: "FORBIDDEN",
    });
    await expect(fileContent(admin, file.id, {})).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(fileLink(admin, randomUUID())).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fileLink(admin, "not-a-uuid")).rejects.toMatchObject({ code: "NOT_FOUND" });
  });

  it("shows an unattached file to its uploader only", async () => {
    const { admin, manager } = await setup();
    const { actor: otherAdmin } = await createTestUser("ADMIN", { allBranches: true });
    const file = await uploadFile(admin, query("service_image"), PNG);

    await expect(fileLink(otherAdmin, file.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // Seeing services is not enough either, until it is attached to one.
    await expect(fileLink(manager, file.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
  });
});

describe("the picture of a service (A-143)", () => {
  async function aService(admin: Awaited<ReturnType<typeof setup>>["admin"], name = "Gói ảnh") {
    return createService(admin, { name, kind: "MEMBER", branchIds: [DEFAULT_BRANCH_ID] });
  }

  it("is set by Admin from their own upload, shown to those who see services, and replaced or removed", async () => {
    const { admin, manager } = await setup();
    const service = await aService(admin);
    const first = await uploadFile(admin, query("service_image"), PNG);

    const withImage = await setServiceImage(admin, service.id, { fileId: first.id });

    expect(withImage.imageFileId).toBe(first.id);
    const served = await fileContent(manager, first.id, queryOf((await fileLink(manager, first.id)).url));
    expect(served.bytes.equals(PNG)).toBe(true);
    const second = await uploadFile(admin, query("service_image"), PNG);
    expect((await setServiceImage(admin, service.id, { fileId: second.id })).imageFileId).toBe(second.id);
    expect((await setServiceImage(admin, service.id, { fileId: null })).imageFileId).toBeNull();
    expect(await prisma.auditEvent.count({ where: { entityId: service.id, action: "service.imageChanged" } })).toBe(3);
  });

  it("refuses a file that is another's, of another purpose, already used, or unknown, and a manager", async () => {
    const { admin, manager, reception } = await setup();
    const { actor: otherAdmin } = await createTestUser("ADMIN", { allBranches: true });
    const service = await aService(admin);
    const other = await aService(admin, "Gói khác");
    const mine = await uploadFile(admin, query("service_image"), PNG);
    const proof = await uploadFile(reception, query("receipt_proof"), PNG);

    await expect(setServiceImage(otherAdmin, service.id, { fileId: mine.id })).rejects.toMatchObject({
      fieldErrors: { fileId: ["invalidChoice"] },
    });
    await expect(setServiceImage(admin, service.id, { fileId: proof.id })).rejects.toMatchObject({
      fieldErrors: { fileId: ["invalidChoice"] },
    });
    await expect(setServiceImage(admin, service.id, { fileId: randomUUID() })).rejects.toMatchObject({
      fieldErrors: { fileId: ["invalidChoice"] },
    });
    await setServiceImage(admin, service.id, { fileId: mine.id });
    await expect(setServiceImage(admin, other.id, { fileId: mine.id })).rejects.toMatchObject({
      fieldErrors: { fileId: ["fileInUse"] },
    });
    await expect(setServiceImage(manager, service.id, { fileId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});

describe("the transfer proof of a receipt (brief §8.1, A-144)", () => {
  async function receipt() {
    const world = await setup();
    const customer = await createCustomer(world.manager, { fullName: "Nguyễn Văn An", phone: "0909123456" });
    const contract = await activeContract(world.manager, customer.id);
    const { payment } = await recordPayment(
      world.reception,
      contract.id,
      { amount: 1_000_000, methodId: CASH, paidOn: "05/10/2026" },
      randomUUID(),
    );
    return { ...world, payment };
  }

  it("is attached by whoever records receipts, seen by those who see receipts, and logged", async () => {
    const { reception, manager, payment } = await receipt();
    const file = await uploadFile(reception, query("receipt_proof"), PNG);

    const updated = await setReceiptProof(reception, payment.id, { fileId: file.id });

    expect(updated.proofFileId).toBe(file.id);
    const served = await fileContent(manager, file.id, queryOf((await fileLink(manager, file.id)).url));
    expect(served.bytes.equals(PNG)).toBe(true);
    expect(await prisma.auditEvent.count({ where: { entityId: payment.id, action: "payment.proof_changed" } })).toBe(1);
    expect((await setReceiptProof(reception, payment.id, { fileId: null })).proofFileId).toBeNull();
  });

  it("is not visible to a user of another branch, nor to a role that cannot see receipts", async () => {
    const { reception, payment } = await receipt();
    const file = await uploadFile(reception, query("receipt_proof"), PNG);
    await setReceiptProof(reception, payment.id, { fileId: file.id });
    const branch = await createTestBranch();
    const { actor: elsewhere } = await createTestUser("FITNESS_MANAGER", { branchIds: [branch.id] });
    const { actor: trainer } = await createTestUser("PT");

    await expect(fileLink(elsewhere, file.id)).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(fileLink(trainer, file.id)).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(setReceiptProof(elsewhere, payment.id, { fileId: null })).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(setReceiptProof(trainer, payment.id, { fileId: null })).rejects.toMatchObject({ code: "FORBIDDEN" });
  });
});
