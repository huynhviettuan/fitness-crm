"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  BanknoteIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ListTodoIcon,
  MegaphoneIcon,
  ClipboardListIcon,
  DumbbellIcon,
  FileTextIcon,
  HistoryIcon,
  IdCardIcon,
  KeyRoundIcon,
  ListChecksIcon,
  ListOrderedIcon,
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
  leads: { href: "/leads", icon: MegaphoneIcon },
  leadsToday: { href: "/leads/today", icon: CalendarCheckIcon },
  customers: { href: "/customers", icon: UsersIcon },
  contracts: { href: "/contracts", icon: FileTextIcon },
  calendar: { href: "/calendar", icon: CalendarDaysIcon },
  sessions: { href: "/sessions", icon: ClipboardCheckIcon },
  tasks: { href: "/tasks", icon: ListTodoIcon },
  finance: { href: "/finance", icon: BanknoteIcon },
  employees: { href: "/employees", icon: IdCardIcon },
  users: { href: "/admin/users", icon: ShieldUserIcon },
  roles: { href: "/admin/roles", icon: KeyRoundIcon },
  branches: { href: "/admin/branches", icon: Building2Icon },
  options: { href: "/admin/options", icon: ListChecksIcon },
  parameters: { href: "/admin/parameters", icon: SlidersHorizontalIcon },
  checklist: { href: "/admin/checklist", icon: ListOrderedIcon },
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
  // The most specific item that contains the page: /leads/today is "Việc hôm nay", not "Lead".
  const current = items
    .filter((key) => pathname === NAV_ITEMS[key].href || pathname.startsWith(`${NAV_ITEMS[key].href}/`))
    .sort((a, b) => NAV_ITEMS[b].href.length - NAV_ITEMS[a].href.length)[0];

  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {items.map((key) => {
            const { href, icon: Icon } = NAV_ITEMS[key];
            const active = key === current;
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
