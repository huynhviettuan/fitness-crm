import { z } from "zod";
import { hasNoControlCharacters, normalizePhone } from "../validation/index.js";
import { whatsAppSecretSchema } from "./whatsapp.js";
import { ZALO_APP_ID_PATTERN } from "./zalo.js";

// The lead intake gateway (brief §11, D-044, TS-007; M10.1; A-261 to A-267): what a channel hands over, and the sources Admin
// registers. A source is one connection (the website form, later WhatsApp and the others) with its own key.

/** Every kind of source the system will have; each is built in its own slice (doc 30). */
export const INTAKE_KINDS = ["WEBSITE", "WHATSAPP", "MESSENGER", "INSTAGRAM", "EMAIL", "ZALO", "TIKTOK"] as const;
export type IntakeKind = (typeof INTAKE_KINDS)[number];

/** The kinds that can be registered now. */
export const AVAILABLE_INTAKE_KINDS = [
  "WEBSITE",
  "WHATSAPP",
  "MESSENGER",
  "INSTAGRAM",
  "EMAIL",
  "ZALO",
] as const satisfies readonly IntakeKind[];

/** The kinds Meta delivers to, each proved by the signature of the app secret and set up with a verify token (A-268, A-275). */
export const META_KINDS = ["WHATSAPP", "MESSENGER", "INSTAGRAM"] as const satisfies readonly IntakeKind[];
export const isMetaKind = (kind: string): kind is (typeof META_KINDS)[number] =>
  (META_KINDS as readonly string[]).includes(kind);

/** The kinds proved by a secret of the platform's app (Meta's app secret, Zalo's OA secret key), kept sealed (A-268, A-294). */
export const needsAppSecret = (kind: string): boolean => isMetaKind(kind) || kind === "ZALO";

/** A message came in from the person, or was sent to them (later, when staff reply from the system). */
export const MESSAGE_DIRECTIONS = ["IN", "OUT"] as const;
export type MessageDirection = (typeof MESSAGE_DIRECTIONS)[number];

export const MAX_MESSAGE_LENGTH = 4000;

const emptyToNull = (value: string) => (value === "" ? null : value);
const text = (max: number) =>
  z.string().trim().max(max, { error: "tooLong" }).refine(hasNoControlCharacters, { error: "invalidCharacters" });
/** A message may be several lines, so line breaks are allowed in it. */
const multiline = (max: number) =>
  z
    .string()
    .trim()
    .max(max, { error: "tooLong" })
    // eslint-disable-next-line no-control-regex
    .refine((value) => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), { error: "invalidCharacters" });

const optionalUuid = z.preprocess(
  (value) => (value === "" ? null : value),
  z.uuid({ error: "invalidChoice" }).nullable(),
);

/** Registering a source: its name, kind, branch, and the channel and source its leads are counted under (AC-06). */
export const intakeSourceInputSchema = z
  .object({
    name: text(100).pipe(z.string().min(1, { error: "required" })),
    kind: z.enum(AVAILABLE_INTAKE_KINDS, { error: "invalidChoice" }),
    branchId: optionalUuid.prefault(""),
    channelId: z.uuid({ error: "required" }),
    sourceId: optionalUuid.prefault(""),
    /**
     * Meta kinds (A-268, A-275): the Meta app secret that signs its webhooks; Zalo (A-294): the OA secret key. Kept sealed and never
     * shown again.
     */
    appSecret: z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), whatsAppSecretSchema]))
      .prefault(""),
    /** Zalo only (A-294): the id of the Zalo app that receives the OA's events; it is part of each event's signature. */
    appId: z
      .string()
      .trim()
      .transform(emptyToNull)
      .pipe(z.union([z.null(), z.string().regex(ZALO_APP_ID_PATTERN, { error: "invalidFormat" })]))
      .prefault(""),
  })
  .superRefine((value, context) => {
    if (needsAppSecret(value.kind) && value.appSecret === null) {
      context.addIssue({ code: "custom", path: ["appSecret"], message: "required" });
    }
    if (!needsAppSecret(value.kind) && value.appSecret !== null) {
      context.addIssue({ code: "custom", path: ["appSecret"], message: "invalidChoice" });
    }
    if (value.kind === "ZALO" && value.appId === null) {
      context.addIssue({ code: "custom", path: ["appId"], message: "required" });
    }
    if (value.kind !== "ZALO" && value.appId !== null) {
      context.addIssue({ code: "custom", path: ["appId"], message: "invalidChoice" });
    }
  });
export type IntakeSourceInput = z.input<typeof intakeSourceInputSchema>;

export const intakeSourceUpdateSchema = z.object({
  name: text(100).pipe(z.string().min(1, { error: "required" })),
  active: z.boolean({ error: "invalidChoice" }),
  channelId: z.uuid({ error: "required" }),
  sourceId: optionalUuid.prefault(""),
});
export type IntakeSourceUpdate = z.input<typeof intakeSourceUpdateSchema>;

/**
 * What the website form sends (A-262). The name is needed, as for any lead (D-060); the phone, email and message are kept when
 * given. `externalId` is the form's own id for this submission: sending it twice makes one lead.
 */
export const websiteLeadSchema = z
  .object({
    externalId: text(200).pipe(z.string().min(1, { error: "required" })),
    name: text(150).pipe(z.string().min(1, { error: "required" })),
    phone: z
      .string()
      .trim()
      .transform(normalizePhone)
      .pipe(z.union([z.literal(""), z.string().regex(/^\+?\d{8,15}$/, { error: "invalidPhone" })]))
      .transform(emptyToNull)
      .prefault(""),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.union([z.literal(""), z.email({ error: "invalidEmail" })]))
      .transform(emptyToNull)
      .prefault(""),
    message: multiline(MAX_MESSAGE_LENGTH).transform(emptyToNull).prefault(""),
    pageUrl: text(500).transform(emptyToNull).prefault(""),
  })
  .strict();
export type WebsiteLead = z.input<typeof websiteLeadSchema>;

// ---------------------------------------------------------------------------------------------------------------- views

export const intakeSourceSchema = z
  .object({
    id: z.uuid(),
    name: z.string(),
    kind: z.enum(INTAKE_KINDS),
    active: z.boolean(),
    branch: z.object({ id: z.uuid(), name: z.string() }),
    channel: z.object({ id: z.uuid(), labelVi: z.string(), labelEn: z.string() }),
    source: z.object({ id: z.uuid(), labelVi: z.string(), labelEn: z.string() }).nullable(),
    lastReceivedAt: z.iso.datetime().nullable(),
    received: z.int(),
    /** Where Meta is told to post (WhatsApp, Messenger, Instagram); the address of the API is added in front by whoever reads it. */
    webhookPath: z.string().nullable(),
    /** Messenger: a Page token is set, so the Page's Lead Ads forms are read (M10.4). The token itself is never returned. */
    hasPageToken: z.boolean(),
    /** Email: the last thing the forwarding sent for Admin to read (Gmail's confirmation of the rule, M10.5). */
    notice: z.object({ text: z.string(), at: z.iso.datetime() }).nullable(),
  })
  .meta({ id: "IntakeSource" });
export type IntakeSource = z.output<typeof intakeSourceSchema>;

export const intakeSourceListSchema = z.object({ items: z.array(intakeSourceSchema) }).meta({ id: "IntakeSourceList" });

/**
 * A source with what is shown once when it is made or replaced: the key of a website source, or the verify token of a WhatsApp
 * source (the app secret is never returned).
 */
export const intakeSourceCreatedSchema = z
  .object({ source: intakeSourceSchema, key: z.string().nullable(), verifyToken: z.string().nullable() })
  .meta({ id: "IntakeSourceCreated" });

/** The answer to the sender: which person the submission became, and whether it was a repeat. */
export const intakeAnswerSchema = z
  .object({
    personId: z.uuid(),
    stage: z.enum(["LEAD", "CUSTOMER"]),
    code: z.string(),
    /** The submission was seen before: nothing was created. */
    duplicate: z.boolean(),
    /** The person already had a record, so the submission was added to it (BR-202). */
    existingPerson: z.boolean(),
  })
  .meta({ id: "IntakeAnswer" });
export type IntakeAnswer = z.output<typeof intakeAnswerSchema>;

export const messageSchema = z
  .object({
    id: z.uuid(),
    direction: z.enum(MESSAGE_DIRECTIONS),
    body: z.string().nullable(),
    senderName: z.string().nullable(),
    receivedAt: z.iso.datetime(),
    source: z.object({ id: z.uuid(), name: z.string(), kind: z.enum(INTAKE_KINDS) }),
  })
  .meta({ id: "IntakeMessage" });
export type IntakeMessage = z.output<typeof messageSchema>;

export const messageListSchema = z.object({ items: z.array(messageSchema) }).meta({ id: "IntakeMessageList" });

/** The prefix of every source key, so a leaked one is recognisable (like the machines' `fcd_`). */
export const INTAKE_KEY_PREFIX = "fci_";
export const INTAKE_KEY_PATTERN = /^fci_[A-Za-z0-9_-]{20,100}$/;
