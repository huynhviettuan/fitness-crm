import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { AppHeader } from "@/components/app-shell/app-header";
import { AppSidebar, type NavItemKey } from "@/components/app-shell/app-sidebar";
import { requirePageUser } from "@/lib/auth/current-user";
import { can } from "@/lib/permissions";

// Every page in the CRM reads the session, so it renders per request instead of
// from a prerendered shell (see next.config.ts).
export const instant = false;

export default async function CrmLayout({ children }: { children: React.ReactNode }) {
  const user = await requirePageUser();

  const mainItems: NavItemKey[] = ["dashboard"];
  if (can(user, "customer.view")) mainItems.push("customers");
  if (can(user, "contract.view")) mainItems.push("contracts");
  if (can(user, "booking.view")) mainItems.push("calendar", "sessions");
  if (can(user, "payment.view")) mainItems.push("finance");
  const adminItems: NavItemKey[] = [];
  if (can(user, "trainer.manage")) adminItems.push("trainers");
  if (can(user, "user.manage")) adminItems.push("users");
  if (can(user, "role.manage")) adminItems.push("roles");
  if (can(user, "branch.manage")) adminItems.push("branches");
  if (can(user, "config.manage")) adminItems.push("options", "parameters");
  if (can(user, "audit.view")) adminItems.push("audit");
  if (can(user, "trash.view")) adminItems.push("trash");

  return (
    <SidebarProvider>
      <AppSidebar mainItems={mainItems} adminItems={adminItems} />
      {/* min-w-0: wide content (e.g. the PT calendar) scrolls inside the page, not the page itself. */}
      <SidebarInset className="min-w-0">
        <AppHeader user={user} showSearch={can(user, "customer.view")} />
        <main className="flex-1 p-4 md:p-6">{children}</main>
      </SidebarInset>
    </SidebarProvider>
  );
}
