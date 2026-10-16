import { formatCode } from "../parameters/parameter.schema.js";

/** D-038: the configured prefix + at least 6 digits, e.g. KH000123. */
export function formatCustomerCode(prefix: string, sequenceValue: bigint | number): string {
  return formatCode(prefix, sequenceValue, 6);
}
