// Pure contract rules: no database, no framework. The API enforces them; the web app
// uses them to show only the actions that can succeed.

/** Stored statuses; EXPIRED is derived from the end date (T-018). Matches the database enum. */
export const CONTRACT_STATUSES = ["DRAFT", "ACTIVE", "CANCELLED"] as const;
export type ContractStatus = (typeof CONTRACT_STATUSES)[number];

export type EffectiveContractStatus = ContractStatus | "EXPIRED";

/** A-003: contract codes are "HD" + at least 6 digits. */
export function formatContractCode(sequenceValue: bigint | number): string {
  return `HD${sequenceValue.toString().padStart(6, "0")}`;
}

/**
 * T-018: an ACTIVE contract whose end date is before the gym's current day is EXPIRED.
 * The end date itself is still valid. `today` is the gym's calendar day at UTC midnight.
 */
export function effectiveStatus(contract: { status: ContractStatus; endDate: Date }, today: Date): EffectiveContractStatus {
  if (contract.status === "ACTIVE" && contract.endDate.getTime() < today.getTime()) return "EXPIRED";
  return contract.status;
}

/** Only drafts can be edited until OQ-015 is answered. */
export function isEditable(status: EffectiveContractStatus): boolean {
  return status === "DRAFT";
}

export function canActivate(status: EffectiveContractStatus): boolean {
  return status === "DRAFT";
}

/** An expired contract is not cancelled; it has already ended (docs/05 state diagram). */
export function canCancel(status: EffectiveContractStatus): boolean {
  return status === "DRAFT" || status === "ACTIVE";
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

/** T-012, BR-013, D-011: every figure is derived; nothing is stored. */
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
