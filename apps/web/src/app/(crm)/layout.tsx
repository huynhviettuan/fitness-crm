import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar, type NavItemKey } from "@/components/app-shell/app-sidebar";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";
import { getApprovalSummary } from "@/lib/api/approvals";
import { getNotificationSummary, listNotifications } from "@/lib/api/notifications";

// Every page in the CRM reads the session, so it renders per request instead of
// from a prerendered shell (see next.config.ts).
export const instant = false;

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();

  // Which items a role sees; the sidebar groups them (lib/navigation.ts).
  const items: NavItemKey[] = ["dashboard"];
  if (can(user, "lead.view")) items.push("leads", "leadsToday", "leadsRecare");
  if (can(user, "lead.audit")) items.push("leadsAudit");
  if (can(user, "lead.assign")) items.push("leadReceivers");
  if (can(user, "customer.view")) items.push("customers");
  if (can(user, "contract.view")) items.push("contracts");
  if (can(user, "booking.view")) items.push("calendar", "sessions");
  if (can(user, "class.view")) items.push("classes");
  if (can(user, "booking.view")) items.push("checkin");
  if (can(user, "task.view")) items.push("tasks");
  if (can(user, "payment.view")) items.push("finance");
  if (can(user, "report.consulting")) items.push("consultingReport");
  if (can(user, "report.leadAnalysis")) items.push("leadAnalysis");
  if (can(user, "report.cashBook")) items.push("cashBookReport");
  if (can(user, "report.incomeExpense")) items.push("incomeExpenseReport");
  if (can(user, "report.contracts")) items.push("contractReport");
  if (can(user, "report.exceptionPrices")) items.push("exceptionPriceReport");
  if (can(user, "report.ptRevenue")) items.push("ptRevenueReport");
  if (can(user, "payout.view")) items.push("ptPayouts");
  if (can(user, "report.bookings")) items.push("bookingReport");
  // A PT sees their own profile and working schedule here (staff scope "only mine").
  if (can(user, "employee.view")) items.push("employees");
  if (can(user, "user.manage")) items.push("users");
  if (can(user, "role.manage")) items.push("roles");
  if (can(user, "branch.manage")) items.push("branches");
  if (can(user, "config.manage")) items.push("options", "sessionStatuses", "parameters", "checklist", "auditCriteria");
  if (can(user, "script.manage")) items.push("scripts");
  if (can(user, "config.manage")) items.push("notificationSettings");
  if (can(user, "mail.template")) items.push("emailTemplates");
  if (can(user, "service.view")) items.push("services");
  if (can(user, "promotion.manage")) items.push("promotions");
  if (can(user, "audit.view")) items.push("audit");
  if (can(user, "trash.view")) items.push("trash");
  if (can(user, "approval.manage")) items.push("approvalRules");
  const [approvals, { unread }, recent] = await Promise.all([
    getApprovalSummary(),
    getNotificationSummary(),
    listNotifications({ pageSize: 8 }),
  ]);

  return (
    <SidebarProvider>
      <AppSidebar items={items} />
      {/* min-w-0: wide content (e.g. the PT calendar) scrolls inside the page, not the page itself. */}
      <SidebarInset className="min-w-0">
        <AppHeader
          user={user}
          showSearch={can(user, "customer.view")}
          approvals={approvals}
          notifications={{ unread, recent: recent.items }}
        />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
