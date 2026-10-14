import { createHash, randomBytes } from "node:crypto";
import { z } from "zod";
import {
  INTAKE_KEY_PATTERN,
  INTAKE_KEY_PREFIX,
  intakeSourceInputSchema,
  intakeSourceUpdateSchema,
  websiteLeadSchema,
  type IntakeAnswer,
  type IntakeMessage,
  type IntakeSource,
} from "@flow/shared/intake";
import type { Prisma } from "../../generated/prisma/client.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { loadCurrentUser } from "../../platform/auth/actor.js";
import type { Actor } from "../../platform/auth/session.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, resolveBranch } from "../../platform/permissions/scope.js";
import { logSecurityEvent } from "../../platform/security/log.js";
import { parseInput } from "../../platform/validation/parse.js";
import { addInquiry } from "../leads/lead-inquiry.service.js";
import { visiblePerson } from "../leads/lead.present.js";
import { createLead } from "../leads/lead.service.js";

// The lead intake gateway (brief §11, D-044, TS-007; M10.1; A-261 to A-267). A source is one connection that hands leads to the
// system, with a key of its own of which only the hash is kept. What it hands over becomes a lead, or an inquiry on the person
// who already has that phone (BR-202, D-019), and is kept as a message on that person. The source's own id for a submission is
// unique, so a repeat is answered with the person it already made and creates nothing.

const sourceSelect = {
  id: true,
  name: true,
  kind: true,
  active: true,
  lastReceivedAt: true,
  branch: { select: { id: true, name: true } },
  channel: { select: { id: true, labelVi: true, labelEn: true } },
  source: { select: { id: true, labelVi: true, labelEn: true } },
  _count: { select: { messages: true } },
} as const satisfies Prisma.IntakeSourceSelect;

type SourceRecord = Prisma.IntakeSourceGetPayload<{ select: typeof sourceSelect }>;

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

/** A key a sender puts in the `x-intake-key` header: long, random, and recognisable in a leak scan. */
function newKey(): string {
  return `${INTAKE_KEY_PREFIX}${randomBytes(32).toString("base64url")}`;
}

function present(record: SourceRecord): IntakeSource {
  const { _count, lastReceivedAt, ...rest } = record;
  return { ...rest, lastReceivedAt: lastReceivedAt?.toISOString() ?? null, received: _count.messages };
}

// ------------------------------------------------------------------------------------------------------------- admin

export async function listSources(actor: Actor): Promise<{ items: IntakeSource[] }> {
  assertCan(actor, "intake.manage");
  const sources = await prisma.intakeSource.findMany({
    where: inBranches(actor),
    select: sourceSelect,
    orderBy: [{ name: "asc" }],
  });
  return { items: sources.map(present) };
}

async function choices(db: Db, data: { channelId: string; sourceId: string | null }) {
  const channel = await resolveChoice(db, "leadChannels", "channelId", { optionId: data.channelId, note: null });
  if (channel.note !== null) throw new AppError("VALIDATION_FAILED", { fieldErrors: { channelId: ["invalidChoice"] } });
  const source = data.sourceId
    ? await resolveChoice(db, "leadSources", "sourceId", { optionId: data.sourceId, note: null })
    : null;
  return { channelId: channel.optionId, sourceId: source?.optionId ?? null };
}

export async function createSource(actor: Actor, input: unknown): Promise<{ source: IntakeSource; key: string }> {
  assertCan(actor, "intake.manage");
  const data = parseInput(intakeSourceInputSchema, input);
  const key = newKey();
  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, data.branchId ?? undefined);
    const chosen = await choices(tx, data);
    const created = await tx.intakeSource.create({
      data: { name: data.name, kind: data.kind, branchId, ...chosen, keyHash: hashKey(key), createdById: actor.id },
      select: sourceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "intake_source",
      entityId: created.id,
      action: "intake_source.created",
      after: {
        name: created.name,
        kind: created.kind,
        branchId,
        channelId: chosen.channelId,
        sourceId: chosen.sourceId,
      },
    });
    return { source: present(created), key };
  });
}

async function findVisible(db: Db, actor: Actor, id: string): Promise<SourceRecord> {
  if (!z.uuid().safeParse(id).success) throw new AppError("NOT_FOUND");
  const source = await db.intakeSource.findFirst({ where: { id, ...inBranches(actor) }, select: sourceSelect });
  if (!source) throw new AppError("NOT_FOUND");
  return source;
}

export async function updateSource(actor: Actor, id: string, input: unknown): Promise<IntakeSource> {
  assertCan(actor, "intake.manage");
  const data = parseInput(intakeSourceUpdateSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await findVisible(tx, actor, id);
    const chosen = await choices(tx, data);
    const after = await tx.intakeSource.update({
      where: { id },
      data: { name: data.name, active: data.active, ...chosen },
      select: sourceSelect,
    });
    const changes = diffFields(
      { name: before.name, active: before.active, channelId: before.channel.id, sourceId: before.source?.id ?? null },
      { name: after.name, active: after.active, channelId: after.channel.id, sourceId: after.source?.id ?? null },
      ["name", "active", "channelId", "sourceId"],
    );
    if (changes) {
      await recordAudit(tx, {
        actorUserId: actor.id,
        entityType: "intake_source",
        entityId: id,
        action: "intake_source.updated",
        ...changes,
      });
    }
    return present(after);
  });
}

/** A lost or leaked key is replaced; the old one stops working at once. */
export async function rotateSourceKey(actor: Actor, id: string): Promise<{ source: IntakeSource; key: string }> {
  assertCan(actor, "intake.manage");
  const key = newKey();
  return prisma.$transaction(async (tx) => {
    await findVisible(tx, actor, id);
    const source = await tx.intakeSource.update({
      where: { id },
      data: { keyHash: hashKey(key) },
      select: sourceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "intake_source",
      entityId: id,
      action: "intake_source.key_rotated",
    });
    return { source: present(source), key };
  });
}

// --------------------------------------------------------------------------------------------------------- the gateway

/** The registered, active source behind a key, or null: only a registered source may hand over leads. */
export async function authenticateSource(key: string) {
  if (!INTAKE_KEY_PATTERN.test(key)) return null;
  return prisma.intakeSource.findFirst({
    where: { keyHash: hashKey(key), active: true },
    select: { id: true, name: true, kind: true, branchId: true, channelId: true, sourceId: true, createdById: true },
  });
}
export type AuthenticatedSource = NonNullable<Awaited<ReturnType<typeof authenticateSource>>>;

/** A source key is allowed this many submissions a minute; a flood is answered with 429 (OWASP A04). */
export const SUBMISSIONS_PER_MINUTE = 60;
const windows = new Map<string, { start: number; count: number }>();

/** Counts a submission against the source; false when it is over the limit. One API process, so memory is enough for now. */
export function withinRate(sourceId: string, now: number = Date.now()): boolean {
  const window = windows.get(sourceId);
  if (!window || now - window.start >= 60_000) {
    windows.set(sourceId, { start: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= SUBMISSIONS_PER_MINUTE;
}

/** The person a submission became, as the sender is told. */
async function answerFor(db: Db, personId: string, duplicate: boolean, existingPerson: boolean): Promise<IntakeAnswer> {
  const person = await db.customer.findUniqueOrThrow({
    where: { id: personId },
    select: { stage: true, leadCode: true, customerCode: true },
  });
  return {
    personId,
    stage: person.stage,
    code: (person.stage === "CUSTOMER" ? person.customerCode : person.leadCode) ?? person.leadCode ?? "",
    duplicate,
    existingPerson,
  };
}

/** The page the form was on is kept with the message, so the consultant sees where the lead came from. */
function bodyOf(data: { message: string | null; pageUrl: string | null }): string | null {
  const parts = [data.message, data.pageUrl ? `[${data.pageUrl}]` : null].filter((part): part is string => !!part);
  return parts.length > 0 ? parts.join("\n\n") : null;
}

/**
 * The website form handed over a submission (A-262). The same `externalId` twice is one lead. A phone that already has a record
 * adds the submission to it as an inquiry (BR-202); otherwise a lead is made in the source's branch and channel, and given to the
 * next consultant in turn (D-050). The source acts as the Admin who registered it.
 */
export async function receiveWebsiteLead(source: AuthenticatedSource, rawBody: unknown): Promise<IntakeAnswer> {
  const data = parseInput(websiteLeadSchema, rawBody);
  const body = bodyOf(data);

  // Claim the submission first: the unique id lets one of two simultaneous copies through.
  let claim: { id: string };
  try {
    claim = await prisma.intakeMessage.create({
      data: { sourceId: source.id, externalId: data.externalId, senderName: data.name, body },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const seen = await prisma.intakeMessage.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId: source.id, externalId: data.externalId } },
      select: { personId: true },
    });
    if (!seen.personId) throw new AppError("INTAKE_IN_PROGRESS");
    return answerFor(prisma, seen.personId, true, true);
  }

  try {
    const actor = await loadCurrentUser(prisma, source.createdById);
    if (!actor || !actor.permissions.has("lead.create")) {
      // The Admin who registered the source can no longer create leads: nothing is lost, the sender retries once it is fixed.
      logSecurityEvent("intake.actor_unusable", { sourceId: source.id }, "warn");
      throw new AppError("INTERNAL_ERROR");
    }
    const note = data.message ? data.message.slice(0, 2000) : null;
    const owner = data.phone
      ? await prisma.customer.findFirst({ where: { phone: data.phone }, select: { id: true } })
      : null;
    let personId: string;
    if (owner) {
      const result = await addInquiry(actor, owner.id, {
        channelId: source.channelId,
        sourceId: source.sourceId ?? "",
        note: note ?? "",
      });
      personId = result.personId;
    } else {
      const lead = await createLead(actor, {
        branchId: source.branchId,
        fullName: data.name,
        phone: data.phone ?? "",
        email: data.email ?? "",
        channelId: source.channelId,
        sourceId: source.sourceId ?? "",
        notes: note ?? "",
      });
      personId = lead.id;
    }
    await prisma.$transaction([
      prisma.intakeMessage.update({ where: { id: claim.id }, data: { personId } }),
      prisma.intakeSource.update({ where: { id: source.id }, data: { lastReceivedAt: new Date() } }),
    ]);
    return await answerFor(prisma, personId, false, owner !== null);
  } catch (error) {
    // Nothing was made: the claim is released so the sender can try again with the same id.
    await prisma.intakeMessage.deleteMany({ where: { id: claim.id, personId: null } });
    throw error;
  }
}

// ----------------------------------------------------------------------------------------------------------- reading

/** The conversation of a lead or customer, oldest first, for someone who may see the person (A-266). */
export async function listMessages(actor: Actor, personId: string): Promise<{ items: IntakeMessage[] }> {
  assertCan(actor, "lead.view");
  await visiblePerson(prisma, actor, personId);
  const messages = await prisma.intakeMessage.findMany({
    where: { personId },
    orderBy: [{ receivedAt: "asc" }, { id: "asc" }],
    select: {
      id: true,
      direction: true,
      body: true,
      senderName: true,
      receivedAt: true,
      source: { select: { id: true, name: true, kind: true } },
    },
  });
  return { items: messages.map((message) => ({ ...message, receivedAt: message.receivedAt.toISOString() })) };
}
