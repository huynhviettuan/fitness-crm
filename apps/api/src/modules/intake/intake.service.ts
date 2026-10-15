import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  INTAKE_KEY_PATTERN,
  INTAKE_KEY_PREFIX,
  intakeSourceInputSchema,
  intakeSourceUpdateSchema,
  graphLeadSchema,
  isMetaKind,
  needsAppSecret,
  leadFromForm,
  pageTokenInputSchema,
  readInboundEmail,
  readZaloEvent,
  parseLeadgenPayload,
  parseMessagingPayload,
  parseWhatsAppPayload,
  websiteLeadSchema,
  whatsAppHandshakeSchema,
  type IntakeAnswer,
  type IntakeKind,
  type LeadgenEvent,
  type IntakeMessage,
  type IntakeSource,
  type WhatsAppReceipt,
} from "@flow/shared/intake";
import type { Prisma } from "../../generated/prisma/client.js";
import { diffFields, recordAudit } from "../../platform/audit/audit.repository.js";
import { loadCurrentUser } from "../../platform/auth/actor.js";
import type { Actor } from "../../platform/auth/session.js";
import { isUniqueViolation } from "../../platform/db/errors.js";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { env } from "../../platform/env.js";
import { AppError } from "../../platform/errors/app-error.js";
import { resolveChoice } from "../../platform/options/option.service.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { inBranches, resolveBranch } from "../../platform/permissions/scope.js";
import { notify } from "../../platform/notifications/notification.service.js";
import { logSecurityEvent } from "../../platform/security/log.js";
import { seal, unseal } from "../../platform/security/sensitive.js";
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
  pageTokenEnc: true,
  lastNotice: true,
  lastNoticeAt: true,
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
  const { _count, lastReceivedAt, pageTokenEnc, lastNotice, lastNoticeAt, ...rest } = record;
  return {
    ...rest,
    lastReceivedAt: lastReceivedAt?.toISOString() ?? null,
    received: _count.messages,
    webhookPath: webhookPathOf(rest.kind, rest.id),
    hasPageToken: pageTokenEnc !== null,
    notice: lastNotice && lastNoticeAt ? { text: lastNotice, at: lastNoticeAt.toISOString() } : null,
  };
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

/** The token Meta echoes when the webhook is registered; shown once, only its hash is kept. */
function newVerifyToken(): string {
  return randomBytes(24).toString("base64url");
}

type Created = { source: IntakeSource; key: string | null; verifyToken: string | null };

export async function createSource(actor: Actor, input: unknown): Promise<Created> {
  assertCan(actor, "intake.manage");
  const data = parseInput(intakeSourceInputSchema, input);
  // Meta kinds get a verify token for their handshake; Zalo has none (A-294); the website and email get a key.
  const meta = isMetaKind(data.kind);
  const key = needsAppSecret(data.kind) ? null : newKey();
  const verifyToken = meta ? newVerifyToken() : null;
  return prisma.$transaction(async (tx) => {
    const branchId = await resolveBranch(tx, actor, data.branchId ?? undefined);
    const chosen = await choices(tx, data);
    const created = await tx.intakeSource.create({
      data: {
        name: data.name,
        kind: data.kind,
        branchId,
        ...chosen,
        keyHash: key ? hashKey(key) : null,
        secretEnc: needsAppSecret(data.kind) ? seal(data.appSecret) : null,
        appRef: data.appId,
        verifyTokenHash: verifyToken ? hashKey(verifyToken) : null,
        createdById: actor.id,
      },
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
    return { source: present(created), key, verifyToken };
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

/**
 * A lost or leaked key is replaced; the old one stops working at once. A Meta source (WhatsApp, Messenger, Instagram) has no key: it gets a new verify token,
 * for registering the webhook again (its messages stay proved by the signature).
 */
export async function rotateSourceKey(actor: Actor, id: string): Promise<Created> {
  assertCan(actor, "intake.manage");
  return prisma.$transaction(async (tx) => {
    const before = await findVisible(tx, actor, id);
    // A Zalo source has nothing to replace: its proof is the OA secret key, which a new source takes (A-294).
    if (before.kind === "ZALO") throw new AppError("VALIDATION_FAILED", { fieldErrors: { kind: ["invalidChoice"] } });
    const meta = isMetaKind(before.kind);
    const key = meta ? null : newKey();
    const verifyToken = meta ? newVerifyToken() : null;
    const source = await tx.intakeSource.update({
      where: { id },
      data: key ? { keyHash: hashKey(key) } : { verifyTokenHash: hashKey(verifyToken ?? "") },
      select: sourceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "intake_source",
      entityId: id,
      action: "intake_source.key_rotated",
    });
    return { source: present(source), key, verifyToken };
  });
}

/**
 * The Page access token of a Messenger source (A-283): with it, the Lead Ads forms of the Page are read from Meta. It is kept sealed,
 * never returned and never audited with its value; setting it again replaces it.
 */
export async function setPageToken(actor: Actor, id: string, input: unknown): Promise<IntakeSource> {
  assertCan(actor, "intake.manage");
  const data = parseInput(pageTokenInputSchema, input);
  return prisma.$transaction(async (tx) => {
    const before = await findVisible(tx, actor, id);
    if (before.kind !== "MESSENGER") {
      throw new AppError("VALIDATION_FAILED", { fieldErrors: { pageToken: ["invalidChoice"] } });
    }
    const source = await tx.intakeSource.update({
      where: { id },
      data: { pageTokenEnc: seal(data.pageToken) },
      select: sourceSelect,
    });
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "intake_source",
      entityId: id,
      action: "intake_source.page_token_set",
      before: { hasPageToken: before.pageTokenEnc !== null },
      after: { hasPageToken: true },
    });
    return present(source);
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
export function withinRate(
  sourceId: string,
  now: number = Date.now(),
  limit: number = SUBMISSIONS_PER_MINUTE,
): boolean {
  const window = windows.get(sourceId);
  if (!window || now - window.start >= 60_000) {
    windows.set(sourceId, { start: now, count: 1 });
    return true;
  }
  window.count += 1;
  return window.count <= limit;
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
    const note = data.message ? data.message.slice(0, 2000) : null;
    const { personId, existingPerson } = await personFor(source, {
      name: data.name,
      phone: data.phone,
      email: data.email,
      note,
    });
    await finishClaim(source.id, claim.id, personId);
    return await answerFor(prisma, personId, false, existingPerson);
  } catch (error) {
    // Nothing was made: the claim is released so the sender can try again with the same id.
    await prisma.intakeMessage.deleteMany({ where: { id: claim.id, personId: null } });
    throw error;
  }
}

/**
 * The person a first message becomes: an inquiry on whoever already has the phone (BR-202, D-019), otherwise a lead in the
 * source's branch and channel, given to the next consultant in turn (D-050). The source acts as the Admin who registered it.
 */
async function personFor(
  source: AuthenticatedSource,
  data: { name: string; phone: string | null; email: string | null; note: string | null; ownerId?: string | null },
): Promise<{ personId: string; existingPerson: boolean }> {
  const actor = await loadCurrentUser(prisma, source.createdById);
  if (!actor || !actor.permissions.has("lead.create")) {
    // The Admin who registered the source can no longer create leads: nothing is lost, the sender retries once it is fixed.
    logSecurityEvent("intake.actor_unusable", { sourceId: source.id }, "warn");
    throw new AppError("INTERNAL_ERROR");
  }
  const owner = data.ownerId
    ? { id: data.ownerId }
    : data.phone
      ? await prisma.customer.findFirst({ where: { phone: data.phone }, select: { id: true } })
      : null;
  if (owner) {
    const result = await addInquiry(actor, owner.id, {
      channelId: source.channelId,
      sourceId: source.sourceId ?? "",
      note: data.note ?? "",
    });
    return { personId: result.personId, existingPerson: true };
  }
  const lead = await createLead(actor, {
    branchId: source.branchId,
    fullName: data.name,
    phone: data.phone ?? "",
    email: data.email ?? "",
    channelId: source.channelId,
    sourceId: source.sourceId ?? "",
    notes: data.note ?? "",
  });
  return { personId: lead.id, existingPerson: false };
}

async function finishClaim(sourceId: string, claimId: string, personId: string): Promise<void> {
  await prisma.$transaction([
    prisma.intakeMessage.update({ where: { id: claimId }, data: { personId } }),
    prisma.intakeSource.update({ where: { id: sourceId }, data: { lastReceivedAt: new Date() } }),
  ]);
}

// ------------------------------------------------------------------------------------------- Meta: WhatsApp, Messenger, Instagram

/** Meta may deliver this many times a minute for one source before we say 429 (a chat is faster than a form). */
export const META_PER_MINUTE = 600;
/** A person who wrote within this long is still in the same conversation (the 24-hour window of WhatsApp and Messenger). */
export const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;

const digest = (value: string) => createHash("sha256").update(value).digest();
const sameText = (a: string, b: string) => timingSafeEqual(digest(a), digest(b));

/** The signature Meta puts in `x-hub-signature-256`: `sha256=` and the HMAC of the exact bytes received, keyed by the app secret. */
export function metaSignature(rawBody: Buffer, appSecret: string): string {
  return `sha256=${createHmac("sha256", appSecret).update(rawBody).digest("hex")}`;
}

/** Which kinds each webhook address serves: WhatsApp has its own (M10.2), Messenger and Instagram share one (M10.3). */
export const WEBHOOK_KINDS = {
  whatsapp: ["WHATSAPP"],
  meta: ["MESSENGER", "INSTAGRAM"],
} as const satisfies Record<string, readonly IntakeKind[]>;
export type WebhookRoute = keyof typeof WEBHOOK_KINDS;

export function webhookPathOf(kind: IntakeKind, id: string): string | null {
  if (kind === "EMAIL") return "/api/v1/intake/email";
  if (kind === "ZALO") return `/api/v1/intake/zalo/${id}`;
  if (kind === "WHATSAPP") return `/api/v1/intake/whatsapp/${id}`;
  if (kind === "MESSENGER" || kind === "INSTAGRAM") return `/api/v1/intake/meta/${id}`;
  return null;
}

async function metaSource(route: WebhookRoute, sourceId: string) {
  if (!z.uuid().safeParse(sourceId).success) return null;
  return prisma.intakeSource.findFirst({
    where: { id: sourceId, kind: { in: [...WEBHOOK_KINDS[route]] }, active: true },
    select: {
      id: true,
      name: true,
      kind: true,
      branchId: true,
      channelId: true,
      sourceId: true,
      createdById: true,
      secretEnc: true,
      verifyTokenHash: true,
      pageTokenEnc: true,
    },
  });
}
type MetaSource = NonNullable<Awaited<ReturnType<typeof metaSource>>>;

/**
 * Meta's handshake when the webhook is registered (A-271, A-275): the challenge is echoed only for the source's own verify token.
 * A source that does not exist, is off, is of another kind, or gets a wrong token is answered the same way, so nothing is learnt by
 * guessing.
 */
export async function answerMetaHandshake(route: WebhookRoute, sourceId: string, query: unknown): Promise<string> {
  const refused = () => {
    logSecurityEvent("intake.webhook_refused", { sourceId, reason: "handshake" }, "warn");
    return new AppError("UNAUTHENTICATED");
  };
  const parsed = whatsAppHandshakeSchema.safeParse(query);
  const source = await metaSource(route, sourceId);
  if (!parsed.success || !source?.verifyTokenHash) throw refused();
  if (!sameText(hashKey(parsed.data["hub.verify_token"]), source.verifyTokenHash)) throw refused();
  return parsed.data["hub.challenge"];
}

/** One message as the channels hand it over: WhatsApp gives a phone, Messenger and Instagram only the sender's id (A-277). */
type ChannelMessage = {
  externalId: string;
  phone: string | null;
  /** Email (M10.5): the sender's address, which says who wrote before the phone does (A-291). */
  email?: string | null;
  senderRef: string | null;
  name: string;
  body: string;
  receivedAt: Date | null;
};

function messagesOf(kind: IntakeKind, payload: unknown): ChannelMessage[] {
  if (kind === "WHATSAPP") return parseWhatsAppPayload(payload).map((message) => ({ ...message, senderRef: null }));
  if (kind === "MESSENGER" || kind === "INSTAGRAM") {
    return parseMessagingPayload(kind, payload).map((message) => ({ ...message, phone: null }));
  }
  return [];
}

/**
 * A delivery from Meta (A-270, A-276). Its signature is checked over the exact bytes against the sealed app secret before anything
 * is read. Each message is taken in once (Meta's message id is unique per source): a person who wrote within 24 hours only adds to
 * the conversation and the consultant is told; otherwise it is a new lead or an inquiry. A failure is a 5xx, so Meta delivers
 * again; what was already taken in is then recognised.
 */
export async function receiveMetaDelivery(
  route: WebhookRoute,
  sourceId: string,
  rawBody: Buffer | undefined,
  signature: string | undefined,
  payload: unknown,
): Promise<WhatsAppReceipt> {
  const source = await metaSource(route, sourceId);
  const secret = source?.secretEnc ? unseal(source.secretEnc) : null;
  const valid =
    source !== null &&
    secret !== null &&
    rawBody !== undefined &&
    typeof signature === "string" &&
    sameText(signature, metaSignature(rawBody, secret));
  if (!valid || !source) {
    logSecurityEvent("intake.webhook_refused", { sourceId, reason: "signature" }, "warn");
    throw new AppError("UNAUTHENTICATED");
  }
  if (!withinRate(source.id, Date.now(), META_PER_MINUTE)) {
    logSecurityEvent("intake.rate_limited", { sourceId: source.id }, "warn");
    throw new AppError("RATE_LIMITED");
  }
  let received = 0;
  let duplicates = 0;
  for (const message of messagesOf(source.kind, payload)) {
    if (await takeIn(source, message)) received += 1;
    else duplicates += 1;
  }
  // Lead Ads forms come on the Page's webhook too, as `leadgen` changes (A-281).
  if (source.kind === "MESSENGER") {
    for (const event of parseLeadgenPayload(payload)) {
      const taken = await takeInFormLead(source, event);
      if (taken === "received") received += 1;
      if (taken === "duplicate") duplicates += 1;
    }
  }
  return { received, duplicates };
}

const ownerSelect = {
  id: true,
  stage: true,
  fullName: true,
  leadCode: true,
  customerCode: true,
  picUserId: true,
  mergedIntoId: true,
} as const satisfies Prisma.CustomerSelect;

/**
 * The person a message belongs to: whoever has the phone (WhatsApp), or the person the same sender's earlier messages went to
 * (Messenger, Instagram; A-277). A person merged away is followed to the one they were merged into (A-279).
 */
async function ownerOf(sourceId: string, message: ChannelMessage) {
  if (message.email) {
    const byEmail = await prisma.customer.findFirst({
      where: { email: { equals: message.email, mode: "insensitive" }, mergedIntoId: null },
      orderBy: { createdAt: "asc" },
      select: ownerSelect,
    });
    if (byEmail) return byEmail;
  }
  if (message.phone) return prisma.customer.findFirst({ where: { phone: message.phone }, select: ownerSelect });
  if (!message.senderRef) return null;
  const earlier = await prisma.intakeMessage.findFirst({
    where: { sourceId, senderRef: message.senderRef, personId: { not: null } },
    orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
    select: { personId: true },
  });
  let id = earlier?.personId ?? null;
  for (let hops = 0; id && hops < 5; hops += 1) {
    const person = await prisma.customer.findUnique({ where: { id }, select: ownerSelect });
    if (!person?.mergedIntoId) return person;
    id = person.mergedIntoId;
  }
  return null;
}

/** One message; false when it had been taken in before. */
async function takeIn(source: AuthenticatedSource, message: ChannelMessage): Promise<boolean> {
  let claim: { id: string };
  try {
    claim = await prisma.intakeMessage.create({
      data: {
        sourceId: source.id,
        externalId: message.externalId,
        senderName: message.name,
        senderRef: message.senderRef,
        body: message.body || null,
        ...(message.receivedAt && message.receivedAt.getTime() <= Date.now() ? { receivedAt: message.receivedAt } : {}),
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const seen = await prisma.intakeMessage.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId: source.id, externalId: message.externalId } },
      select: { personId: true },
    });
    // Still being handled by another delivery: Meta is told to try again.
    if (!seen.personId) throw new AppError("INTAKE_IN_PROGRESS");
    return false;
  }
  try {
    const owner = await ownerOf(source.id, message);
    const recent = owner
      ? await prisma.intakeMessage.findFirst({
          where: {
            sourceId: source.id,
            personId: owner.id,
            direction: "IN",
            receivedAt: { gt: new Date(Date.now() - CONVERSATION_WINDOW_MS) },
          },
          select: { id: true },
        })
      : null;
    if (owner && recent) {
      // The same conversation goes on: no new inquiry, only the consultant is told (A-272).
      await prisma.$transaction(async (tx) => {
        await tx.intakeMessage.update({ where: { id: claim.id }, data: { personId: owner.id } });
        await tx.intakeSource.update({ where: { id: source.id }, data: { lastReceivedAt: new Date() } });
        await notify(tx, [owner.picUserId], {
          kind: "leadInquiry",
          params: {
            code: (owner.stage === "CUSTOMER" ? owner.customerCode : owner.leadCode) ?? "",
            name: owner.fullName,
          },
          link: owner.stage === "CUSTOMER" ? `/customers/${owner.id}` : `/leads/${owner.id}`,
        });
      });
      return true;
    }
    const { personId } = await personFor(source, {
      name: message.name,
      phone: message.phone,
      email: message.email ?? null,
      note: message.body ? message.body.slice(0, 2000) : null,
      ownerId: owner?.id ?? null,
    });
    await finishClaim(source.id, claim.id, personId);
    return true;
  } catch (error) {
    await prisma.intakeMessage.deleteMany({ where: { id: claim.id, personId: null } });
    throw error;
  }
}

// ------------------------------------------------------------------------------------------------------------ Lead Ads

/** How long Meta has to answer for one lead before the delivery fails and Meta sends it again. */
const GRAPH_TIMEOUT_MS = 10_000;

/**
 * The answers of one form lead, read from Meta with the Page token (A-282). The token goes in the header, never in the address, so
 * it is in no log. Any failure (Meta down, a bad or expired token, a lead Meta does not know) is our fault to Meta: a 5xx, so the
 * delivery comes again, and it is logged without the token.
 */
async function readFormLead(source: MetaSource, leadgenId: string) {
  const token = unseal(source.pageTokenEnc);
  const fail = (reason: string) => {
    logSecurityEvent("intake.graph_failed", { sourceId: source.id, reason }, "warn");
    return new AppError("INTERNAL_ERROR");
  };
  let response: Response;
  try {
    response = await fetch(`${env.META_GRAPH_URL}/${leadgenId}?fields=id,created_time,field_data`, {
      headers: { authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(GRAPH_TIMEOUT_MS),
    });
  } catch {
    throw fail("unreachable");
  }
  if (!response.ok) throw fail(`status ${response.status}`);
  const lead = graphLeadSchema.safeParse(await response.json().catch(() => null));
  if (!lead.success || lead.data.id !== leadgenId) throw fail("unreadable");
  return leadFromForm(lead.data);
}

/**
 * One form lead (A-281 to A-284): claimed by Meta's lead id like a message, its answers read from Meta, then a lead or an inquiry on
 * the person who has the phone, like a website form. Without a Page token it cannot be read: it is skipped and logged, and Meta is
 * answered 200 (A-284).
 */
async function takeInFormLead(source: MetaSource, event: LeadgenEvent): Promise<"received" | "duplicate" | "skipped"> {
  if (!source.pageTokenEnc) {
    logSecurityEvent("intake.leadgen_without_token", { sourceId: source.id }, "warn");
    return "skipped";
  }
  const externalId = `leadgen:${event.leadgenId}`;
  let claim: { id: string };
  try {
    claim = await prisma.intakeMessage.create({
      data: {
        sourceId: source.id,
        externalId,
        senderName: "Lead Ads",
        ...(event.createdAt && event.createdAt.getTime() <= Date.now() ? { receivedAt: event.createdAt } : {}),
      },
      select: { id: true },
    });
  } catch (error) {
    if (!isUniqueViolation(error)) throw error;
    const seen = await prisma.intakeMessage.findUniqueOrThrow({
      where: { sourceId_externalId: { sourceId: source.id, externalId } },
      select: { personId: true },
    });
    if (!seen.personId) throw new AppError("INTAKE_IN_PROGRESS");
    return "duplicate";
  }
  try {
    const form = await readFormLead(source, event.leadgenId);
    const name = form.name ?? `Lead Ads ${event.leadgenId.slice(-6)}`;
    await prisma.intakeMessage.update({
      where: { id: claim.id },
      data: { senderName: name, body: form.answers || null },
    });
    const { personId } = await personFor(source, {
      name,
      phone: form.phone,
      email: form.email,
      note: form.answers ? form.answers.slice(0, 2000) : null,
    });
    await finishClaim(source.id, claim.id, personId);
    return "received";
  } catch (error) {
    await prisma.intakeMessage.deleteMany({ where: { id: claim.id, personId: null } });
    throw error;
  }
}

// --------------------------------------------------------------------------------------------------------------- Email

/**
 * An email forwarded from the gym's Gmail through the inbound-mail service (A-287 to A-292). The source proves itself with its key
 * as the Basic password of the webhook address. Gmail's confirmation of the forwarding rule is kept on the source for Admin to read;
 * an auto-reply, a bounce or a mailing list is skipped; an email a person wrote is taken in like a WhatsApp message, the sender found
 * by the address first and then by a phone written in it.
 */
export async function receiveEmail(source: AuthenticatedSource, payload: unknown): Promise<WhatsAppReceipt> {
  const mail = readInboundEmail(payload);
  if (!mail)
    throw new AppError("VALIDATION_FAILED", { fieldErrors: { MessageID: ["required"], FromFull: ["required"] } });
  if (mail.kind === "gmailConfirmation") {
    await prisma.intakeSource.update({
      where: { id: source.id },
      data: { lastNotice: mail.notice, lastNoticeAt: new Date() },
    });
    return { received: 0, duplicates: 0 };
  }
  if (mail.kind === "automatic") return { received: 0, duplicates: 0 };
  const taken = await takeIn(source, {
    externalId: mail.externalId,
    phone: mail.phone,
    email: mail.email,
    senderRef: null,
    name: mail.name,
    body: mail.body,
    receivedAt: mail.receivedAt,
  });
  return taken ? { received: 1, duplicates: 0 } : { received: 0, duplicates: 1 };
}

// ---------------------------------------------------------------------------------------------------------------- Zalo

/**
 * The signature Zalo puts in `X-ZEvent-Signature` (developers.zalo.me, Webhook → Tin nhắn): `mac = sha256(appId + data + timeStamp +
 * OAsecretKey)`, with `data` the body as received and `timeStamp` the event's `timestamp` field. A plain SHA-256, not an HMAC.
 */
export function zaloSignature(appId: string, rawBody: Buffer, timestamp: string, secret: string): string {
  return createHash("sha256").update(appId).update(rawBody).update(timestamp).update(secret).digest("hex");
}

/** The hex of `mac=<hex>` (or the bare hex) in the header, lower-cased; null when it is not one. */
function zaloMac(header: string | undefined): string | null {
  const match = /^(?:mac\s*=\s*)?([0-9a-f]{64})$/i.exec(header?.trim() ?? "");
  return match ? match[1]!.toLowerCase() : null;
}

/**
 * An event of the gym's Zalo OA (A-294 to A-300). The signature is checked over the exact bytes with the source's app id and sealed
 * OA secret key before anything is used, and the event must name that app. A user's message or shared information is taken in like a
 * Messenger message (the user id is the thread), the shared phone finding a known person; other events are answered 200 and dropped.
 * Zalo sends an event again only when it cannot connect, so a failure here is logged with the event's id (A-299).
 */
export async function receiveZalo(
  sourceId: string,
  rawBody: Buffer | undefined,
  signature: string | undefined,
  payload: unknown,
): Promise<WhatsAppReceipt> {
  const source = z.uuid().safeParse(sourceId).success
    ? await prisma.intakeSource.findFirst({
        where: { id: sourceId, kind: "ZALO", active: true },
        select: {
          id: true,
          name: true,
          kind: true,
          branchId: true,
          channelId: true,
          sourceId: true,
          createdById: true,
          secretEnc: true,
          appRef: true,
        },
      })
    : null;
  const event = readZaloEvent(payload);
  const timestamp = String((payload as { timestamp?: unknown } | null)?.timestamp ?? "");
  const mac = zaloMac(signature);
  const secret = source?.secretEnc ? unseal(source.secretEnc) : null;
  const valid =
    source !== null &&
    secret !== null &&
    source.appRef !== null &&
    rawBody !== undefined &&
    mac !== null &&
    event.appId === source.appRef &&
    sameText(mac, zaloSignature(source.appRef, rawBody, timestamp, secret));
  if (!valid || !source) {
    logSecurityEvent("intake.webhook_refused", { sourceId, reason: "signature" }, "warn");
    throw new AppError("UNAUTHENTICATED");
  }
  if (!withinRate(source.id, Date.now(), META_PER_MINUTE)) {
    logSecurityEvent("intake.rate_limited", { sourceId: source.id }, "warn");
    throw new AppError("RATE_LIMITED");
  }
  if (event.kind === "ignored") return { received: 0, duplicates: 0 };
  try {
    const taken = await takeIn(source, {
      externalId: event.externalId,
      phone: event.phone,
      senderRef: event.senderRef,
      name: event.name,
      body: event.body,
      receivedAt: event.receivedAt,
    });
    return taken ? { received: 1, duplicates: 0 } : { received: 0, duplicates: 1 };
  } catch (error) {
    logSecurityEvent("intake.event_lost", { sourceId: source.id, externalId: event.externalId }, "warn");
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
    // A channel's time may be whole seconds (WhatsApp): two messages of one second keep the order they arrived in.
    orderBy: [{ receivedAt: "asc" }, { createdAt: "asc" }, { id: "asc" }],
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
