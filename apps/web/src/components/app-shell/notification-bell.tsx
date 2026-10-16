"use client";

import { useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { BellIcon, CheckCheckIcon } from "lucide-react";
import { cn } from "cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { DateTime } from "@/components/date-time";
import { notify } from "@/components/notify";
import { useNotificationText } from "@/components/notification-text";
import { useErrorMessage } from "@/components/use-error-message";
import { markAllNotificationsReadAction, markNotificationReadAction } from "@/app/(crm)/actions";
import type { Notification } from "@gymcrm/shared/notifications";

/** The bell in the top bar (docs/08): the unread count and the latest notifications. */
export function NotificationBell({ unread, recent }: { unread: number; recent: Notification[] }) {
  const t = useTranslations("notifications");
  const text = useNotificationText();
  const router = useRouter();
  const errorMessage = useErrorMessage();
  const [, startTransition] = useTransition();

  const open = (notification: Notification) =>
    startTransition(async () => {
      if (!notification.readAt) await markNotificationReadAction(notification.id);
      if (notification.link) router.push(notification.link);
      router.refresh();
    });

  const readAll = () =>
    startTransition(async () => {
      const result = await markAllNotificationsReadAction();
      if (!result.ok) return void notify.error(errorMessage(result.code));
      notify.success(t("allRead"));
      router.refresh();
    });

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" size="sm" className="relative" aria-label={t("bell", { count: unread })}>
          <BellIcon />
          {unread > 0 && <Badge variant="destructive">{unread > 99 ? "99+" : unread}</Badge>}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
        <DropdownMenuLabel className="flex items-center justify-between gap-2">
          {t("title")}
          {unread > 0 && (
            <Button variant="ghost" size="sm" onClick={readAll} className="h-7 px-2 text-xs">
              <CheckCheckIcon />
              {t("markAllRead")}
            </Button>
          )}
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        {recent.length === 0 ? (
          <p className="px-2 py-4 text-center text-sm text-muted-foreground">{t("empty")}</p>
        ) : (
          recent.map((notification) => (
            <DropdownMenuItem
              key={notification.id}
              onSelect={() => open(notification)}
              className="flex flex-col items-start gap-0.5"
            >
              <span className={cn("text-sm whitespace-normal", !notification.readAt && "font-medium")}>
                {!notification.readAt && <span className="sr-only">{t("unread")}: </span>}
                {text(notification)}
              </span>
              <span className="text-xs text-muted-foreground">
                <DateTime value={notification.createdAt} format="dateTime" />
              </span>
            </DropdownMenuItem>
          ))
        )}
        <DropdownMenuSeparator />
        <DropdownMenuItem asChild>
          <Link href="/notifications" className="justify-center text-sm">
            {t("seeAll")}
          </Link>
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
