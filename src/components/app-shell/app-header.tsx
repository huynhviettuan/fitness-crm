import { useTranslations } from "next-intl";
import { Separator } from "@/components/ui/separator";
import { SidebarTrigger } from "@/components/ui/sidebar";
import { CustomerSearch } from "@/components/app-shell/customer-search";
import { UserMenu } from "@/components/app-shell/user-menu";
import type { CurrentUser } from "@/lib/auth/session";

export function AppHeader({ user, showSearch }: { user: CurrentUser; showSearch: boolean }) {
  const t = useTranslations("common");

  return (
    <header className="sticky top-0 z-10 flex h-14 items-center gap-3 border-b bg-background/95 px-4 backdrop-blur">
      <SidebarTrigger aria-label={t("toggleSidebar")} />
      <Separator orientation="vertical" className="h-5!" />
      <div className="flex flex-1 items-center">{showSearch && <CustomerSearch />}</div>
      <UserMenu user={{ name: user.name, email: user.email, role: user.role }} />
    </header>
  );
}
