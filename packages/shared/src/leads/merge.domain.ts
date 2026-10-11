import type { LeadStatus, PersonStage } from "./lead.schema.js";

// Merging two records of one person (BR-202, D-019, A-064, A-066). Pure rules; the API
// applies them inside one locked transaction.

export type MergeCandidate = { id: string; stage: PersonStage; createdAt: Date };

export type MergePlan =
  | { ok: true; survivorId: string; mergedId: string }
  /** Two customers would need their contracts, receipts, and sessions moved: refused (OQ-033). */
  | { ok: false; reason: "BOTH_CUSTOMERS" };

/**
 * A-064: a customer survives (keeps its code and contracts); two leads: the older one
 * (earlier createdAt, then the smaller id) keeps its codes.
 */
export function planMerge(a: MergeCandidate, b: MergeCandidate): MergePlan {
  if (a.stage === "CUSTOMER" && b.stage === "CUSTOMER") return { ok: false, reason: "BOTH_CUSTOMERS" };
  if (a.stage !== b.stage) {
    const survivor = a.stage === "CUSTOMER" ? a : b;
    const merged = survivor === a ? b : a;
    return { ok: true, survivorId: survivor.id, mergedId: merged.id };
  }
  const aFirst = a.createdAt.getTime() !== b.createdAt.getTime() ? a.createdAt < b.createdAt : a.id < b.id;
  return aFirst ? { ok: true, survivorId: a.id, mergedId: b.id } : { ok: true, survivorId: b.id, mergedId: a.id };
}

/**
 * Profile fields filled from the merged record when the survivor has none (A-066). A group
 * is copied together or not at all: a choice with its note, an ID document with its type
 * and the customer's consent.
 */
export const MERGE_FILL_GROUPS = [
  ["gender"],
  ["dateOfBirth"],
  ["email"],
  ["phone"],
  ["channelId", "channelNote"],
  ["sourceId", "sourceNote", "sourceType", "sourceDetail"],
  ["nationalityGroup"],
  ["needGroupId", "needGroupNote", "needDetail"],
  ["painStatusId", "painStatusNote"],
  ["assessmentTypeId", "assessmentTypeNote"],
  ["nationality"],
  ["healthNote"],
  ["idDocumentType", "idDocumentNumber", "dataConsentAt", "dataConsentById"],
] as const;

/** Fields whose different values are recorded in the merge row, not merged (A-066). */
export const MERGE_CONFLICT_FIELDS = ["phone", "email"] as const;

type Row = Record<string, unknown>;

const empty = (value: unknown) => value === null || value === undefined || value === "";

/**
 * What to write on the survivor: only fields of an entirely empty group, taken from the
 * merged record. Never overwrites. `conflicts` lists phone/email that differ.
 */
export function fillEmptyFields(
  survivor: Row,
  merged: Row,
): { fill: Record<string, unknown>; conflicts: (typeof MERGE_CONFLICT_FIELDS)[number][] } {
  const fill: Record<string, unknown> = {};
  for (const group of MERGE_FILL_GROUPS) {
    const survivorEmpty = group.every((key) => empty(survivor[key]));
    const mergedHas = group.some((key) => !empty(merged[key]));
    if (!survivorEmpty || !mergedHas) continue;
    for (const key of group) fill[key] = merged[key] ?? null;
  }
  const conflicts = MERGE_CONFLICT_FIELDS.filter(
    (key) => !empty(survivor[key]) && !empty(merged[key]) && survivor[key] !== merged[key],
  );
  return { fill, conflicts };
}

/** A new inquiry on a record in re-care brings it back to Consulting (A-063). */
export function inquiryReopens(status: LeadStatus | null): boolean {
  return status === "NO_RESPONSE" || status === "REFUSED" || status === "NO_SHOW";
}
