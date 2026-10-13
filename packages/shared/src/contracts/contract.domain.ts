// Pure contract rules: no database, no framework. The API enforces them; the web app
// uses them to show only the actions that can succeed.
import { formatCode } from "../parameters/parameter.schema.js";
import { endDateOf } from "../services/service.domain.js";

/**
 * Stored statuses; EXPIRED is derived from the end date (T-018). Matches the database enum. DRAFT is "pending approval"
 * (A-120); REJECTED is a contract the approver turned down (A-121).
 */
export const CONTRACT_STATUSES = ["DRAFT", "ACTIVE", "CANCELLED", "REJECTED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type EffectiveContractStatus = ContractStatus | "EXPIRED";

/** A contract is new or the renewal of an earlier one (brief §5.2). */
export const CONTRACT_TYPES = ["NEW", "RENEW"] as const;
export type ContractType = (typeof CONTRACT_TYPES)[number];

/** The staff who share a contract (brief §5.2): the PTs who train and the sales staff who sold it. */
export const STAFF_ROLES = ["PT", "SALE"] as const;
export type StaffRole = (typeof STAFF_ROLES)[number];

/** D-038: the configured prefix + at least 6 digits, e.g. HD000123. */
export function formatContractCode(prefix: string, sequenceValue: bigint | number): string {
  return formatCode(prefix, sequenceValue, 6);
}

/**
 * T-018: an ACTIVE contract whose end date is before the gym's current day is EXPIRED.
 * The end date itself is still valid. `today` is the gym's calendar day at UTC midnight.
 */
export function effectiveStatus(
  contract: { status: ContractStatus; endDate: Date },
  today: Date,
): EffectiveContractStatus {
  if (contract.status === "ACTIVE" && contract.endDate.getTime() < today.getTime()) return "EXPIRED";
  return contract.status;
}

/** Only drafts can be edited until OQ-015 is answered. */
export function isEditable(status: EffectiveContractStatus): boolean {
  return status === "DRAFT";
}

/** Only a contract waiting for approval is approved or rejected (D-018). */
export function canActivate(status: EffectiveContractStatus): boolean {
  return status === "DRAFT";
}

/** Unapproving sends an approved contract back to pending (A-124). */
export function canUnapprove(status: EffectiveContractStatus): boolean {
  return status === "ACTIVE";
}

/** An expired contract is not cancelled; it has already ended (docs/05 state diagram). */
export function canCancel(status: EffectiveContractStatus): boolean {
  return status === "DRAFT" || status === "ACTIVE";
}

/** The sessions a contract entitles: the ones bought and the bonus ones, kept apart on the contract (brief §5.1). */
export function entitledSessions(bought: number, bonus: number): number {
  return bought + bonus;
}

/**
 * The last day of a contract (A-108, A-114): the start day counts, and the tier's validity and the bonus months and
 * days add up.
 */
export function contractEndDate(
  start: Date,
  validity: { months: number; days: number },
  bonus: { months: number; days: number },
): Date {
  return endDateOf(start, validity.months + bonus.months, validity.days + bonus.days);
}

export type Share = { employeeId: string; percent: number };

/**
 * What is wrong with the shares of one role (A-115): whether any are needed, repeated staff, and the total, which must
 * be 100. Empty when fine. Percents have two decimals, so the total is compared in hundredths.
 */
export function sharesProblems(
  shares: readonly Share[],
  required: boolean,
): ("sharesRequired" | "duplicateEmployee" | "sharesTotal")[] {
  if (shares.length === 0) return required ? ["sharesRequired"] : [];
  const problems: ("sharesRequired" | "duplicateEmployee" | "sharesTotal")[] = [];
  if (new Set(shares.map((share) => share.employeeId)).size !== shares.length) problems.push("duplicateEmployee");
  const total = shares.reduce((sum, share) => sum + Math.round(share.percent * 100), 0);
  if (total !== 10_000) problems.push("sharesTotal");
  return problems;
}

/** The sales staff are always needed; the PTs when the service is PT training (A-115). */
export function ptSharesRequired(serviceKind: "PT" | "CLASS" | "MEMBER"): boolean {
  return serviceKind === "PT";
}

export type ContractFigures = {
  totalSessions: number;
  openingSessionsUsed: number;
  completedSessions: number;
  remainingSessions: number;
  contractValue: number;
  openingPaidAmount: number;
  confirmedPaidAmount: number;
  paidAmount: number;
  debt: number;
};

/** T-012, BR-013, D-011: every figure is derived; nothing is stored. `totalSessions` is bought plus bonus. */
export function contractFigures(input: {
  totalSessions: number;
  openingSessionsUsed: number;
  completedSessions: number;
  contractValue: number;
  openingPaidAmount: number;
  confirmedPaidAmount: number;
}): ContractFigures {
  const paidAmount = input.openingPaidAmount + input.confirmedPaidAmount;
  return {
    ...input,
    remainingSessions: input.totalSessions - input.openingSessionsUsed - input.completedSessions,
    paidAmount,
    debt: input.contractValue - paidAmount,
  };
}
