import {
  EMAIL_EVENTS,
  EMAIL_EVENT_KEYS,
  EMAIL_PLACEHOLDERS,
  EMAIL_TEMPLATE_DEFAULTS,
  emailTemplateInputSchema,
  isEmailEvent,
  renderTemplate,
  templateProblems,
  type EmailEvent,
  type EmailLocale,
  type EmailTemplate,
  type EmailTemplateView,
  type EmailValues,
} from "@flow/shared/mail";
import { prisma, type Db } from "../../platform/db/prisma.js";
import { AppError } from "../../platform/errors/app-error.js";
import type { Actor } from "../../platform/auth/session.js";
import { recordAudit } from "../../platform/audit/audit.repository.js";
import { assertCan } from "../../platform/permissions/assert.js";
import { parseInput } from "../../platform/validation/parse.js";
import * as repo from "./mail.repository.js";

// Email templates (M6.2, brief §8.3, D-036, D-059; FR-MAIL-001; A-177 to A-180): admin edits the words of each customer
// email, in Vietnamese and English. The events and the placeholders they offer are fixed in the code.

function textsOf(record: repo.TemplateRecord | null, event: EmailEvent): EmailTemplate {
  return record
    ? { subjectVi: record.subjectVi, bodyVi: record.bodyVi, subjectEn: record.subjectEn, bodyEn: record.bodyEn }
    : EMAIL_TEMPLATE_DEFAULTS[event];
}

function toView(event: EmailEvent, record: repo.TemplateRecord | null): EmailTemplateView {
  const definition = EMAIL_EVENTS[event];
  const required: readonly string[] = definition.required;
  return {
    event,
    nameVi: definition.vi,
    nameEn: definition.en,
    mandatory: definition.mandatory,
    placeholders: definition.placeholders.map((name) => ({
      name,
      labelVi: EMAIL_PLACEHOLDERS[name].vi,
      labelEn: EMAIL_PLACEHOLDERS[name].en,
      required: required.includes(name),
    })),
    ...textsOf(record, event),
    updatedAt: record?.updatedAt?.toISOString() ?? null,
    updatedBy: record?.updatedBy?.name ?? null,
  };
}

export async function listTemplates(actor: Actor): Promise<{ items: EmailTemplateView[] }> {
  assertCan(actor, "mail.template");
  const records = await repo.listTemplates(prisma);
  return {
    items: EMAIL_EVENT_KEYS.map((event) => toView(event, records.find((record) => record.event === event) ?? null)),
  };
}

function eventOf(value: string): EmailEvent {
  if (!isEmailEvent(value)) throw new AppError("NOT_FOUND");
  return value;
}

export async function getTemplate(actor: Actor, event: string): Promise<EmailTemplateView> {
  assertCan(actor, "mail.template");
  const key = eventOf(event);
  return toView(key, await repo.findTemplate(prisma, key));
}

/**
 * Saves the words of an event. A text may only use the placeholders the event offers, and the body of each language
 * must still tell the customer what D-036 says it must (the sessions left; for a refund, the reason).
 */
export async function updateTemplate(actor: Actor, event: string, rawInput: unknown): Promise<EmailTemplateView> {
  assertCan(actor, "mail.template");
  const key = eventOf(event);
  const data = parseInput(emailTemplateInputSchema, rawInput);
  const problems = templateProblems(key, data);
  if (Object.keys(problems).length > 0) throw new AppError("VALIDATION_FAILED", { fieldErrors: problems });
  return prisma.$transaction(async (tx) => {
    const before = await repo.findTemplate(tx, key);
    const saved = await repo.saveTemplate(tx, key, data, actor.id);
    await recordAudit(tx, {
      actorUserId: actor.id,
      entityType: "email_template",
      entityId: saved.id,
      action: "email_template.updated",
      before: textsOf(before, key),
      after: textsOf(saved, key),
      context: { event: key },
    });
    return toView(key, saved);
  });
}

/** The subject and body of an event for a customer, with their values filled in; the default text if no row is left. */
export async function renderEmail(
  db: Db,
  event: EmailEvent,
  locale: EmailLocale,
  values: EmailValues,
): Promise<{ subject: string; body: string }> {
  const texts = textsOf(await repo.findTemplate(db, event), event);
  return locale === "vi"
    ? { subject: renderTemplate(texts.subjectVi, values), body: renderTemplate(texts.bodyVi, values) }
    : { subject: renderTemplate(texts.subjectEn, values), body: renderTemplate(texts.bodyEn, values) };
}
