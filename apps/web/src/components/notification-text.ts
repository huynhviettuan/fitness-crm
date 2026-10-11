"use client";

import { useTranslations } from "next-intl";
import { APPROVAL_STATUSES, type ApprovalStatus } from "@flow/shared/approvals";
import type { Notification } from "@flow/shared/notifications";

/**
 * A notification's sentence in the user's language (FR-PLT-009). The API stores only
 * the kind and its values, so text follows the language the user reads in now.
 */
export function useNotificationText(): (notification: Pick<Notification, "kind" | "params">) => string {
  const t = useTranslations("notifications.kinds");
  const tStatus = useTranslations("status.approval");
  return ({ kind, params }) => {
    const values: Record<string, string> = { title: "", by: "", due: "", status: "", code: "", name: "", ...params };
    if (kind === "approvalDecided") {
      const status = (APPROVAL_STATUSES as readonly string[]).includes(values.status)
        ? tStatus(values.status as ApprovalStatus)
        : values.status;
      return t(kind, { ...values, status });
    }
    return t(kind, values);
  };
}
