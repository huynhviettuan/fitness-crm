"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { cn } from "cn";
import { Button } from "@/components/ui/button";
import { DateTime } from "@/components/date-time";
import { EmptyState } from "@/components/empty-state";
import { notify } from "@/components/notify";
import { useNotificationText } from "@/components/notification-text";
import { useErrorMessage } from "@/components/use-error-message";
import { markAllNotificationsReadAction, markNotificationReadAction } from "../actions";
import type { Notification } from "@flow/shared/notifications";

export function NotificationList({ notifications }: { notifications: Notification[] }) {
  const t = useTranslations("notifications");
  const text = useNotificationText();
  const router = useRouter();
  const [, startTransition] = useTransition();

  if (notifications.length === 0) return <EmptyState icon={BellIcon} title={t("empty")} />;

  const open = (notification: Notification) =>
    startTransition(async () => {
      if (!notification.readAt) await markNotificationReadAction(notification.id);
      if (notification.link) router.push(notification.link);
      else router.refresh();
    });

  return (
    <ul aria-label={t("title")} className="flex flex-col divide-y rounded-lg border">
      {notifications.map((notification) => (
        <li key={notification.id}>
          <button
            type="button"
            onClick={() => open(notification)}
            className="flex w-full flex-col items-start gap-1 px-4 py-3 text-left hover:bg-muted/60 focus-visible:bg-muted focus-visible:outline-none"
          >
            <span className={cn("flex items-center gap-2 text-sm", !notification.readAt && "font-medium")}>
              {!notification.readAt && <span aria-hidden="true" className="size-2 shrink-0 rounded-full bg-primary" />}
              {!notification.readAt && <span className="sr-only">{t("unread")}: </span>}
              {text(notification)}
            </span>
            <span className="text-xs text-muted-foreground">
              <DateTime value={notification.createdAt} format="dateTime" />
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export function MarkAllReadButton() {
  const t = useTranslations("notifications");
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [pending, startTransition] = useTransition();
  return (
    <Button
      variant="outline"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          const result = await markAllNotificationsReadAction();
          if (!result.ok) return void notify.error(errorMessage(result.code));
          notify.success(t("allRead"));
          router.refresh();
        })
      }
    >
      <CheckCheckIcon />
      {t("markAllRead")}
    </Button>
  );
}
