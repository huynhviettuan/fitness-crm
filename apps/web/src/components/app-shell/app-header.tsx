import Link from "next/link";
import { useTranslations } from "next-intl";
import { InboxIcon } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CustomerSearch } from "@/components/app-shell/customer-search";
import { UserMenu } from "@/components/app-shell/user-menu";
import { NotificationBell } from "@/components/app-shell/notification-bell";
import type { Notification } from "@flow/shared/notifications";
import type { CurrentUser } from "@/lib/auth/current-user";

type ApprovalCounts = { toDecide: number; overdue: number };

type HeaderProps = {
  user: CurrentUser;
  showSearch: boolean;
  approvals: ApprovalCounts;
  notifications: { unread: number; recent: Notification[] };
};

export function AppHeader({ user, showSearch, approvals, notifications }: HeaderProps) {
  const t = useTranslations("common");
  const ta = useTranslations("approvals");

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-1 border-b bg-background/95 px-4 backdrop-blur sm:gap-3">
      <SidebarTrigger aria-label={t("toggleSidebar")} />
      <Separator orientation="vertical" className="h-5!" />
      {/* min-w-0: on a phone the search shrinks so the bar never overflows (AC-23). */}
      <div className="flex min-w-0 flex-1 items-center">{showSearch && <CustomerSearch />}</div>
      {/* The approvals inbox (docs/08): what waits for this user's decision (D-018). */}
      <Button asChild variant="ghost" size="sm" className="relative">
        <Link href="/approvals" aria-label={ta("inboxLabel", { count: approvals.toDecide })}>
          <InboxIcon />
          <span className="hidden sm:inline">{ta("title")}</span>
          {approvals.toDecide > 0 && (
            <Badge variant={approvals.overdue > 0 ? "destructive" : "default"}>{approvals.toDecide}</Badge>
          )}
        </Link>
      </Button>
      <NotificationBell unread={notifications.unread} recent={notifications.recent} />
      <UserMenu user={{ name: user.name, email: user.email, roleName: user.role.name }} />
    </header>
  );
}
