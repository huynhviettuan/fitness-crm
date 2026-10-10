// A-003: customer codes are "KH" + at least 6 digits, e.g. KH000123.
export function formatCustomerCode(sequenceValue: bigint | number): string {
  return `KH${sequenceValue.toString().padStart(6, "0")}`;
}
