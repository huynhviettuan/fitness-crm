import { z } from "zod";
import { nationalityGroupOf } from "../countries/country.js";
import { hasNoControlCharacters } from "../validation/index.js";
import type { EmailLocale } from "./mail.domain.js";

// Email templates (M6.2, brief §8.3, D-036, D-059; FR-MAIL-001, FR-MAIL-002; A-177 to A-180). Admin writes the subject
// and body of each event in Vietnamese and English with placeholders such as {customerName}; the language follows the
// customer's nationality group. Pure rules, shared by the API, the editor's preview, and the tests.

/** What a placeholder stands for, and a sample for the preview. Names are the words between the braces. */
export const EMAIL_PLACEHOLDERS = {
  customerName: { vi: "Tên khách hàng", en: "Customer's name", sample: { vi: "Nguyễn Văn An", en: "An Nguyen" } },
  contractCode: { vi: "Mã hợp đồng", en: "Contract code", sample: { vi: "HD000123", en: "HD000123" } },
  packageName: { vi: "Tên gói", en: "Package name", sample: { vi: "PT 24 buổi", en: "PT 24 sessions" } },
  day: { vi: "Ngày (dd/MM/yyyy)", en: "Day (dd/MM/yyyy)", sample: { vi: "20/10/2026", en: "20/10/2026" } },
  time: { vi: "Giờ bắt đầu (HH:mm)", en: "Start time (HH:mm)", sample: { vi: "18:00", en: "18:00" } },
  trainerName: { vi: "Tên PT", en: "Trainer's name", sample: { vi: "PT Minh", en: "Coach Minh" } },
  className: { vi: "Tên lớp", en: "Class name", sample: { vi: "Group Training 18:00", en: "Group Training 18:00" } },
  used: { vi: "Số buổi đã dùng", en: "Sessions used", sample: { vi: "10", en: "10" } },
  remaining: { vi: "Số buổi còn lại", en: "Sessions left", sample: { vi: "14", en: "14" } },
  reason: { vi: "Lý do", en: "Reason", sample: { vi: "Ghi nhầm buổi tập", en: "Recorded by mistake" } },
} as const;
export type EmailPlaceholder = keyof typeof EMAIL_PLACEHOLDERS;

type EventDefinition = {
  vi: string;
  en: string;
  /** Mandatory events always go out and cannot be switched off (D-036). */
  mandatory: boolean;
  /** The placeholders the texts may use. */
  placeholders: readonly EmailPlaceholder[];
  /** The placeholders every text must contain: what the customer must be told (D-036). */
  required: readonly EmailPlaceholder[];
};

const SESSION = [
  "customerName",
  "contractCode",
  "packageName",
  "day",
  "time",
  "trainerName",
  "used",
  "remaining",
] as const;

/** The events a customer is emailed about, in the order the editor lists them. */
export const EMAIL_EVENTS = {
  "session.credited": {
    vi: "Buổi tập đã ghi nhận (Đã tập)",
    en: "Session recorded (trained)",
    mandatory: true,
    placeholders: SESSION,
    required: ["used", "remaining"],
  },
  "session.noShow": {
    vi: "Buổi tập tính vào hợp đồng khi khách không đến",
    en: "Session counted when the customer did not come",
    mandatory: true,
    placeholders: SESSION,
    required: ["used", "remaining"],
  },
  "session.added": {
    vi: "Buổi tập thêm tay (Burn Show)",
    en: "Session added by hand (Burn Show)",
    mandatory: true,
    placeholders: [...SESSION, "reason"],
    required: ["used", "remaining"],
  },
  "session.refunded": {
    vi: "Hoàn lại buổi tập (xóa khỏi lịch sử)",
    en: "Session refunded (deleted from the history)",
    mandatory: true,
    placeholders: [...SESSION, "reason"],
    required: ["remaining", "reason"],
  },
  "class.attended": {
    vi: "Buổi lớp đã điểm danh có mặt",
    en: "Class session marked present",
    mandatory: true,
    placeholders: [
      "customerName",
      "contractCode",
      "packageName",
      "day",
      "time",
      "trainerName",
      "className",
      "used",
      "remaining",
    ],
    required: ["used", "remaining"],
  },
} as const satisfies Record<string, EventDefinition>;
export type EmailEvent = keyof typeof EMAIL_EVENTS;
export const EMAIL_EVENT_KEYS = Object.keys(EMAIL_EVENTS) as EmailEvent[];

export function isEmailEvent(value: string): value is EmailEvent {
  return value in EMAIL_EVENTS;
}

export type EmailTemplate = { subjectVi: string; bodyVi: string; subjectEn: string; bodyEn: string };

const FOOTER = {
  vi: "\n\nNếu có điều gì chưa đúng, xin liên hệ phòng tập.",
  en: "\n\nIf anything looks wrong, please contact the gym.",
};

/** The texts the migration starts with, and the ones used if a row is ever missing. */
export const EMAIL_TEMPLATE_DEFAULTS: Record<EmailEvent, EmailTemplate> = {
  "session.credited": {
    subjectVi: "Đã ghi nhận 1 buổi tập, hợp đồng {contractCode}",
    bodyVi: `Chào {customerName},\n\nBuổi tập ngày {day} lúc {time} với {trainerName} đã được ghi nhận vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.${FOOTER.vi}`,
    subjectEn: "1 session recorded, contract {contractCode}",
    bodyEn: `Hello {customerName},\n\nYour session of {day} at {time} with {trainerName} was recorded on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.${FOOTER.en}`,
  },
  "session.noShow": {
    subjectVi: "Buổi tập vắng được tính vào hợp đồng {contractCode}",
    bodyVi: `Chào {customerName},\n\nBạn không đến buổi tập ngày {day} lúc {time} với {trainerName}, nên buổi này được tính vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.${FOOTER.vi}`,
    subjectEn: "Missed session counted, contract {contractCode}",
    bodyEn: `Hello {customerName},\n\nYou did not come to your session of {day} at {time} with {trainerName}, so it was counted on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.${FOOTER.en}`,
  },
  "session.added": {
    subjectVi: "Ghi nhận thêm 1 buổi tập, hợp đồng {contractCode}",
    bodyVi: `Chào {customerName},\n\nPhòng tập vừa ghi nhận thêm 1 buổi tập ngày {day} vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.${FOOTER.vi}`,
    subjectEn: "1 session recorded, contract {contractCode}",
    bodyEn: `Hello {customerName},\n\nThe gym recorded 1 more session of {day} on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.${FOOTER.en}`,
  },
  "session.refunded": {
    subjectVi: "Hoàn lại 1 buổi tập, hợp đồng {contractCode}",
    bodyVi: `Chào {customerName},\n\nBuổi tập ngày {day} của hợp đồng {contractCode} đã được xóa khỏi lịch sử tập và hoàn lại 1 buổi. Lý do: {reason}. Số buổi còn lại: {remaining}.${FOOTER.vi}`,
    subjectEn: "1 session refunded, contract {contractCode}",
    bodyEn: `Hello {customerName},\n\nThe session of {day} on contract {contractCode} was removed from your training history and 1 session was refunded. Reason: {reason}. Sessions left: {remaining}.${FOOTER.en}`,
  },
  "class.attended": {
    subjectVi: "Đã ghi nhận 1 buổi lớp {className}, hợp đồng {contractCode}",
    bodyVi: `Chào {customerName},\n\nBạn đã có mặt ở lớp {className} ngày {day} lúc {time} (HLV {trainerName}); buổi này được tính vào hợp đồng {contractCode}. Số buổi đã dùng: {used}. Số buổi còn lại: {remaining}.${FOOTER.vi}`,
    subjectEn: "1 class session recorded ({className}), contract {contractCode}",
    bodyEn: `Hello {customerName},\n\nYou attended {className} on {day} at {time} (coach {trainerName}); it was counted on contract {contractCode}. Sessions used: {used}. Sessions left: {remaining}.${FOOTER.en}`,
  },
};

/** The placeholders written in a text, as names (those with a brace pair around a word). */
export function placeholdersIn(text: string): string[] {
  return [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]!);
}

export type EmailValues = Partial<Record<EmailPlaceholder, string | number>>;

/**
 * Fills a text with the values. A placeholder with no value is left out as an empty string, so a template never sends
 * a raw `{reason}`; the editor's validation keeps unknown names from being saved at all.
 */
export function renderTemplate(text: string, values: EmailValues): string {
  return text.replace(/\{(\w+)\}/g, (_, name: string) => String(values[name as EmailPlaceholder] ?? ""));
}

/** The sample values of the editor's preview, in a language. */
export function sampleValues(locale: EmailLocale): EmailValues {
  return Object.fromEntries(Object.entries(EMAIL_PLACEHOLDERS).map(([name, entry]) => [name, entry.sample[locale]]));
}

/** The language of an email to a customer: their nationality group decides; Vietnamese when it is not known yet (D-036). */
export function emailLocaleFor(countryCode: string | null | undefined): EmailLocale {
  return nationalityGroupOf(countryCode ?? null) === "FOREIGN" ? "en" : "vi";
}

const subject = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(200, { error: "tooLong" })
  .refine(hasNoControlCharacters, { error: "invalidCharacters" })
  .regex(/^[^\r\n\t]*$/, { error: "invalidCharacters" });

// A body has line breaks; no other control character.
const body = z
  .string()
  .trim()
  .min(1, { error: "required" })
  .max(5000, { error: "tooLong" })
  .refine((value) => hasNoControlCharacters(value.replace(/[\r\n\t]/g, "")), { error: "invalidCharacters" });

export const emailTemplateInputSchema = z.object({
  subjectVi: subject,
  bodyVi: body,
  subjectEn: subject,
  bodyEn: body,
});
export type EmailTemplateInput = z.input<typeof emailTemplateInputSchema>;

/**
 * What is wrong with a template of an event, by field: a placeholder the event does not offer (`unknownPlaceholder`),
 * or one the customer must be told that is missing (`missingPlaceholder`, D-036). Empty when it can be saved.
 */
export function templateProblems(
  event: EmailEvent,
  template: EmailTemplate,
): Partial<Record<keyof EmailTemplate, string[]>> {
  const definition: EventDefinition = EMAIL_EVENTS[event];
  const problems: Partial<Record<keyof EmailTemplate, string[]>> = {};
  for (const field of ["subjectVi", "bodyVi", "subjectEn", "bodyEn"] as const) {
    const used = placeholdersIn(template[field]);
    const errors: string[] = [];
    if (used.some((name) => !definition.placeholders.includes(name as EmailPlaceholder)))
      errors.push("unknownPlaceholder");
    // What the customer must be told has to be in the body of each language.
    if (field.startsWith("body") && definition.required.some((name) => !used.includes(name))) {
      errors.push("missingPlaceholder");
    }
    if (errors.length > 0) problems[field] = errors;
  }
  return problems;
}

/** An event with its template, as the editor shows it. */
export const emailTemplateSchema = z
  .object({
    event: z.string(),
    nameVi: z.string(),
    nameEn: z.string(),
    mandatory: z.boolean(),
    /** The placeholders the event offers, with what each stands for. */
    placeholders: z.array(
      z.object({ name: z.string(), labelVi: z.string(), labelEn: z.string(), required: z.boolean() }),
    ),
    subjectVi: z.string(),
    bodyVi: z.string(),
    subjectEn: z.string(),
    bodyEn: z.string(),
    /** Null while the template is still the one the system started with. */
    updatedAt: z.iso.datetime().nullable(),
    updatedBy: z.string().nullable(),
  })
  .meta({ id: "EmailTemplate" });

export const emailTemplateListSchema = z
  .object({ items: z.array(emailTemplateSchema) })
  .meta({ id: "EmailTemplateList" });

export type EmailTemplateView = z.output<typeof emailTemplateSchema>;
