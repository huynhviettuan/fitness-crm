"use client";

import { useTranslations } from "next-intl";
import type { ErrorCode } from "@/lib/errors/app-error";

/** toUserMessage: turns an API/action error code into a translated message (docs/23 §4). */
export function useErrorMessage(): (code: ErrorCode) => string {
  const t = useTranslations("errors");
  return (code) => t(code);
}
