// Pure finance rules: no database, no framework. Used by the API and unit-tested
// directly.

/**
 * OQ-003 interim: a payment may not take the paid amount (opening balance plus
 * confirmed payments, D-011) above the contract value.
 */
export function exceedsContractValue(
  contract: { contractValue: number; openingPaidAmount: number; confirmedPaidAmount: number },
  amount: number,
): boolean {
  return contract.openingPaidAmount + contract.confirmedPaidAmount + amount > contract.contractValue;
}

/** Money is recorded when it changed hands, so a day after the gym's today is refused. */
export function isFutureDay(day: Date, today: Date): boolean {
  return day.getTime() > today.getTime();
}

/** The first and last calendar day of a month (UTC midnight), from "yyyy-MM". */
export function monthRange(month: string): { from: Date; to: Date } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(month);
  if (!match) return null;
  const year = Number(match[1]);
  const index = Number(match[2]) - 1;
  if (index < 0 || index > 11) return null;
  return { from: new Date(Date.UTC(year, index, 1)), to: new Date(Date.UTC(year, index + 1, 0)) };
}
