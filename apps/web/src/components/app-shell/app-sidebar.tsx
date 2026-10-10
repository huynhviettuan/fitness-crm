"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BanknoteIcon,
  Building2Icon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  DumbbellIcon,
  FileTextIcon,
  HistoryIcon,
  IdCardIcon,
  KeyRoundIcon,
  ListChecksIcon,
  LayoutDashboardIcon,
  SlidersHorizontalIcon,
  Trash2Icon,
  ShieldUserIcon,
  UsersIcon,
} from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@/components/ui/sidebar";

// Items appear as their phase is built. The layout decides which ones a role sees;
// hiding an item is UX only, the server enforces access.
const NAV_ITEMS = {
  dashboard: { href: "/dashboard", icon: LayoutDashboardIcon },
  customers: { href: "/customers", icon: UsersIcon },
  contracts: { href: "/contracts", icon: FileTextIcon },
  calendar: { href: "/calendar", icon: CalendarDaysIcon },
  sessions: { href: "/sessions", icon: ClipboardCheckIcon },
  finance: { href: "/finance", icon: BanknoteIcon },
  trainers: { href: "/trainers", icon: IdCardIcon },
  users: { href: "/admin/users", icon: ShieldUserIcon },
  roles: { href: "/admin/roles", icon: KeyRoundIcon },
  branches: { href: "/admin/branches", icon: Building2Icon },
  options: { href: "/admin/options", icon: ListChecksIcon },
  parameters: { href: "/admin/parameters", icon: SlidersHorizontalIcon },
  audit: { href: "/admin/audit", icon: HistoryIcon },
  trash: { href: "/admin/trash", icon: Trash2Icon },
  approvalRules: { href: "/admin/approvals", icon: ClipboardListIcon },
} as const;

export type NavItemKey = keyof typeof NAV_ITEMS;

type AppSidebarProps = {
  mainItems: NavItemKey[];
  adminItems: NavItemKey[];
};

export function AppSidebar({ mainItems, adminItems }: AppSidebarProps) {
  const t = useTranslations("nav");

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link href="/dashboard" className="flex items-center gap-2 px-2 py-1.5 font-semibold">
          <span className="flex size-7 items-center justify-center rounded-md bg-primary text-primary-foreground">
            <DumbbellIcon className="size-4" />
          </span>
          <span className="truncate group-data-[collapsible=icon]:hidden">Fitness CRM</span>
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <NavGroup label={t("main")} items={mainItems} />
        {adminItems.length > 0 && <NavGroup label={t("administration")} items={adminItems} />}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function NavGroup({ label, items }: { label: string; items: NavItemKey[] }) {
  const t = useTranslations("nav");
  const pathname = usePathname();

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((key) => {
            const { href, icon: Icon } = NAV_ITEMS[key];
            const active = pathname === href || pathname.startsWith(`${href}/`);
            return (
              <SidebarMenuItem key={key}>
                <SidebarMenuButton asChild isActive={active} tooltip={t(key)}>
                  <Link href={href} aria-current={active ? "page" : undefined}>
                    <Icon />
                    <span>{t(key)}</span>
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
