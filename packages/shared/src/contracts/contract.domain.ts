// Pure contract rules: no database, no framework. The API enforces them; the web app
// uses them to show only the actions that can succeed.
import { formatCode } from "../parameters/parameter.schema.js";
import { endDateOf } from "../services/service.domain.js";

/**
 * Stored statuses; EXPIRED is derived from the end date (T-018). Matches the database enum. DRAFT is "pending approval"
 * (A-120); REJECTED is a contract the approver turned down (A-121); FROZEN is one deactivated for review (D-023).
 */
export const CONTRACT_STATUSES = ["DRAFT", "ACTIVE", "CANCELLED", "REJECTED", "FROZEN"] as const;
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
  return status === "DRAFT" || status === "ACTIVE" || status === "FROZEN";
}

/** Only a running contract is deactivated (D-023); an expired one has ended. */
export function canDeactivate(status: EffectiveContractStatus): boolean {
  return status === "ACTIVE";
}

export function canReactivate(status: EffectiveContractStatus): boolean {
  return status === "FROZEN";
}

/**
 * The days a contract was frozen (D-023, brief §5.5): from the day it was deactivated to the day it is reactivated.
 * Frozen on 1 November and reactivated on 11 November is 10 days.
 */
export function frozenDaysBetween(frozenOn: Date, reactivatedOn: Date): number {
  return Math.max(0, Math.round((reactivatedOn.getTime() - frozenOn.getTime()) / DAY_MS));
}

/** The end date once `days` frozen days are added back (brief §5.5: ending 04/01/2027 after 10 days is 14/01/2027). */
export function endDateAfterFreeze(endDate: Date, days: number): Date {
  return new Date(endDate.getTime() + days * DAY_MS);
}

/** How a reactivation treats the frozen days: add them all, a number of days chosen, or none (D-023). */
export const EXTENSION_CHOICES = ["ALL", "CUSTOM", "NONE"] as const;
export type ExtensionChoice = (typeof EXTENSION_CHOICES)[number];

/** A customer's standing, derived from their contracts (D-040, brief §4.2). On hold arrives with freezes (M4.6). */
export const CUSTOMER_CONTRACT_STATUSES = ["NO_CONTRACT", "TRAINING", "EXPIRING_SOON", "EXPIRED", "ON_HOLD"] as const;
export type CustomerContractStatus = (typeof CUSTOMER_CONTRACT_STATUSES)[number];

const DAY_MS = 86_400_000;

/**
 * Training while an approved contract runs, expiring soon when the one that runs longest ends within `soonDays`,
 * expired when every approved contract has ended, and no contract when none was ever approved (D-040, A-131).
 * Pending, rejected, and cancelled contracts do not count. `today` is the gym's day at UTC midnight.
 */
export function customerContractStatus(
  contracts: readonly { status: ContractStatus; endDate: Date }[],
  today: Date,
  soonDays: number,
): CustomerContractStatus {
  const approved = contracts.filter((contract) => contract.status === "ACTIVE" || contract.status === "FROZEN");
  if (approved.length === 0) return "NO_CONTRACT";
  // A frozen contract does not expire while it lasts (D-023), so the customer is still training.
  if (approved.some((contract) => contract.status === "FROZEN")) return "TRAINING";
  const running = approved.filter((contract) => contract.endDate.getTime() >= today.getTime());
  if (running.length === 0) return "EXPIRED";
  const lastEnd = Math.max(...running.map((contract) => contract.endDate.getTime()));
  return lastEnd - today.getTime() <= soonDays * DAY_MS ? "EXPIRING_SOON" : "TRAINING";
}

/** How much of a contract is paid (brief §5.3 filter): nothing, part of it, or all of it. */
export const PAYMENT_STATUSES = ["UNPAID", "PARTIAL", "PAID"] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function paymentStatusOf(contractValue: number, paidAmount: number): PaymentStatus {
  if (paidAmount <= 0) return "UNPAID";
  return paidAmount >= contractValue ? "PAID" : "PARTIAL";
}

/** The statuses the list can be filtered by: the stored ones and the derived EXPIRED. */
export const LIST_STATUSES = [...CONTRACT_STATUSES, "EXPIRED"] as const;

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
