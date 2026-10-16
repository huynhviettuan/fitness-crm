import type { ApprovalAction } from "@gymcrm/shared/approvals";

/** Message keys cannot contain dots (next-intl nests on them): "payment.create" → "payment_create". */
export function messageKey<A extends ApprovalAction>(action: A) {
  return action.replace(".", "_") as A extends `${infer E}.${infer V}` ? `${E}_${V}` : never;
}
