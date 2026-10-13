"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, useSyncExternalStore } from "react";
import { useTranslations } from "next-intl";
import {
  BanknoteIcon,
  Building2Icon,
  CalendarCheckIcon,
  CalendarDaysIcon,
  ClipboardCheckIcon,
  ListTodoIcon,
  MegaphoneIcon,
  PackageIcon,
  TicketPercentIcon,
  PhoneForwardedIcon,
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
  ChartColumnIcon,
  BookOpenIcon,
  ChartPieIcon,
  FingerprintPatternIcon,
  PaletteIcon,
  FileChartColumnIcon,
  TagsIcon,
  ChevronRightIcon,
  ScaleIcon,
  ScanSearchIcon,
  ScrollTextIcon,
  ShieldUserIcon,
  UsersIcon,
  UsersRoundIcon,
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
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
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarRail,
  useSidebar,
} from "@/components/ui/sidebar";
import { buildNav, groupOf, type NavGroupKey, type NavItemKey, type NavNode } from "@/lib/navigation";

// The layout decides which items a role sees and `buildNav` groups them (A-105); hiding an item is UX only,
// the server enforces access.
const NAV_ITEMS: Record<NavItemKey, { href: string; icon: typeof LayoutDashboardIcon }> = {
  dashboard: { href: "/dashboard", icon: LayoutDashboardIcon },
  leads: { href: "/leads", icon: MegaphoneIcon },
  leadsToday: { href: "/leads/today", icon: CalendarCheckIcon },
  leadsRecare: { href: "/leads/recare", icon: PhoneForwardedIcon },
  leadsAudit: { href: "/leads/audit", icon: ScanSearchIcon },
  leadReceivers: { href: "/leads/receivers", icon: UsersRoundIcon },
  consultingReport: { href: "/reports/consulting", icon: ChartColumnIcon },
  leadAnalysis: { href: "/reports/lead-analysis", icon: ChartPieIcon },
  cashBookReport: { href: "/reports/cash-book", icon: BookOpenIcon },
  incomeExpenseReport: { href: "/reports/income-expense", icon: ScaleIcon },
  contractReport: { href: "/reports/contracts", icon: FileChartColumnIcon },
  exceptionPriceReport: { href: "/reports/exception-prices", icon: TagsIcon },
  customers: { href: "/customers", icon: UsersIcon },
  contracts: { href: "/contracts", icon: FileTextIcon },
  calendar: { href: "/calendar", icon: CalendarDaysIcon },
  sessions: { href: "/sessions", icon: ClipboardCheckIcon },
  checkin: { href: "/checkin", icon: FingerprintPatternIcon },
  tasks: { href: "/tasks", icon: ListTodoIcon },
  finance: { href: "/finance", icon: BanknoteIcon },
  employees: { href: "/employees", icon: IdCardIcon },
  users: { href: "/admin/users", icon: ShieldUserIcon },
  roles: { href: "/admin/roles", icon: KeyRoundIcon },
  branches: { href: "/admin/branches", icon: Building2Icon },
  options: { href: "/admin/options", icon: ListChecksIcon },
  parameters: { href: "/admin/parameters", icon: SlidersHorizontalIcon },
  sessionStatuses: { href: "/admin/session-statuses", icon: PaletteIcon },
  checklist: { href: "/admin/checklist", icon: ListOrderedIcon },
  scripts: { href: "/admin/scripts", icon: ScrollTextIcon },
  services: { href: "/admin/services", icon: PackageIcon },
  promotions: { href: "/admin/promotions", icon: TicketPercentIcon },
  auditCriteria: { href: "/admin/audit-criteria", icon: ScaleIcon },
  audit: { href: "/admin/audit", icon: HistoryIcon },
  trash: { href: "/admin/trash", icon: Trash2Icon },
  approvalRules: { href: "/admin/approvals", icon: ClipboardListIcon },
};

const GROUP_ICONS: Record<NavGroupKey, typeof LayoutDashboardIcon> = {
  leads: MegaphoneIcon,
  customers: UsersIcon,
  schedule: CalendarDaysIcon,
  reports: ChartColumnIcon,
  people: ShieldUserIcon,
  config: SlidersHorizontalIcon,
  monitoring: HistoryIcon,
};

export type { NavItemKey };

type AppSidebarProps = {
  items: NavItemKey[];
};

export function AppSidebar({ items }: AppSidebarProps) {
  const pathname = usePathname();
  const sections = buildNav(items);
  // The most specific item that contains the page: /leads/today is "Việc hôm nay", not "Lead".
  const current = items
    .filter((key) => pathname === NAV_ITEMS[key].href || pathname.startsWith(`${NAV_ITEMS[key].href}/`))
    .sort((a, b) => NAV_ITEMS[b].href.length - NAV_ITEMS[a].href.length)[0];

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
        {sections.map((section) => (
          <NavSection key={section.label} label={section.label} nodes={section.nodes} current={current} />
        ))}
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function NavSection({
  label,
  nodes,
  current,
}: {
  label: "main" | "administration";
  nodes: NavNode[];
  current: NavItemKey | undefined;
}) {
  const t = useTranslations("nav");
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{t(label)}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu>
          {nodes.map((node) =>
            node.kind === "item" ? (
              <NavLeaf key={node.key} itemKey={node.key} active={node.key === current} />
            ) : (
              <NavFolder key={node.key} group={node.key} items={node.items} current={current} />
            ),
          )}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

function NavLeaf({ itemKey, active }: { itemKey: NavItemKey; active: boolean }) {
  const t = useTranslations("nav");
  const { href, icon: Icon } = NAV_ITEMS[itemKey];
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={active} tooltip={t(itemKey)}>
        <Link href={href} aria-current={active ? "page" : undefined}>
          <Icon />
          <span>{t(itemKey)}</span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

const STORAGE_PREFIX = "nav-open:";
const listeners = new Set<() => void>();

/** What the user last chose for a group in this browser: "1" open, "0" closed, null never chosen or no storage. */
function readChoice(group: NavGroupKey): string | null {
  try {
    return window.localStorage.getItem(STORAGE_PREFIX + group);
  } catch {
    return null;
  }
}

function saveChoice(group: NavGroupKey, open: boolean) {
  try {
    window.localStorage.setItem(STORAGE_PREFIX + group, open ? "1" : "0");
  } catch {
    // The choice just is not remembered.
  }
  listeners.forEach((listener) => listener());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  window.addEventListener("storage", listener);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", listener);
  };
}

/** A group: open when the page is inside it, otherwise as the user left it (A-105). */
function NavFolder({
  group,
  items,
  current,
}: {
  group: NavGroupKey;
  items: NavItemKey[];
  current: NavItemKey | undefined;
}) {
  const t = useTranslations("nav");
  const { state, isMobile, setOpen: setSidebarOpen } = useSidebar();
  const holdsCurrent = current !== undefined && groupOf(current) === group;
  const Icon = GROUP_ICONS[group];
  // The saved choice is read in the browser only, so the first render matches the server's.
  const saved = useSyncExternalStore(
    subscribe,
    () => readChoice(group),
    () => null,
  );
  // A choice made here, and going into the group opens it; both beat the saved choice until the page leaves it.
  const [forced, setForced] = useState<boolean | null>(holdsCurrent ? true : null);
  const [seen, setSeen] = useState(current);
  if (seen !== current) {
    setSeen(current);
    setForced(holdsCurrent ? true : null);
  }
  const open = forced ?? (saved === null ? holdsCurrent : saved === "1");

  const change = (next: boolean) => {
    setForced(next);
    saveChoice(group, next);
  };

  return (
    <Collapsible open={open} onOpenChange={change} className="group/collapsible" asChild>
      <SidebarMenuItem>
        <CollapsibleTrigger asChild>
          <SidebarMenuButton
            tooltip={t(`groups.${group}`)}
            isActive={holdsCurrent && !open}
            onClick={(event) => {
              // With only the icons showing, a click widens the sidebar and opens the group.
              if (state === "collapsed" && !isMobile) {
                event.preventDefault();
                setSidebarOpen(true);
                change(true);
              }
            }}
          >
            <Icon />
            <span>{t(`groups.${group}`)}</span>
            <ChevronRightIcon className="ml-auto transition-transform group-data-[state=open]/collapsible:rotate-90" />
          </SidebarMenuButton>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <SidebarMenuSub>
            {items.map((key) => {
              const { href, icon: ItemIcon } = NAV_ITEMS[key];
              const active = key === current;
              return (
                <SidebarMenuSubItem key={key}>
                  <SidebarMenuSubButton asChild isActive={active}>
                    <Link href={href} aria-current={active ? "page" : undefined}>
                      <ItemIcon />
                      <span>{t(key)}</span>
                    </Link>
                  </SidebarMenuSubButton>
                </SidebarMenuSubItem>
              );
            })}
          </SidebarMenuSub>
        </CollapsibleContent>
      </SidebarMenuItem>
    </Collapsible>
  );
}
