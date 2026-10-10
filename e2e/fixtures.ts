// The composition root for E2E specs: specs import `test` and `expect` from here,
// never from @playwright/test, and never construct page objects themselves.
import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import type { Role } from "@flow/shared/permissions";
import { AppShell } from "./pages/app-shell";
import { CalendarPage, CustomerBookingsTab, SessionsPage, TrainersPage } from "./pages/bookings";
import { ContractDetailPage, CustomerContractsTab } from "./pages/contracts";
import { FinancePage } from "./pages/finance";
import { CustomerDetailPage, CustomersPage } from "./pages/customers";
import { LoginPage } from "./pages/login-page";
import { connect } from "./support/db";
import { storageStatePath } from "./support/paths";

type Fixtures = {
  shell: AppShell;
  loginPage: LoginPage;
  customersPage: CustomersPage;
  customerDetailPage: CustomerDetailPage;
  customerContractsTab: CustomerContractsTab;
  contractDetailPage: ContractDetailPage;
  customerBookingsTab: CustomerBookingsTab;
  calendarPage: CalendarPage;
  sessionsPage: SessionsPage;
  trainersPage: TrainersPage;
  financePage: FinancePage;
  /**
   * A unique marker for names this test creates. Teardown deletes every customer and
   * trainer whose name contains it, with their contracts, bookings, and payments, and
   * every cash transaction whose category contains it, even if the test failed halfway.
   */
  testTag: string;
  /**
   * A raw HTTP client, signed in as `role` (or anonymous with null). By default it
   * sends the app's own Origin, like a browser on the app would; pass `origin` to
   * act as another site, or null to send none. Disposed after the test.
   */
  apiAs: (role: Role | null, options?: { origin?: string | null }) => Promise<APIRequestContext>;
};

export const test = base.extend<Fixtures>({
  shell: async ({ page }, use) => use(new AppShell(page)),
  loginPage: async ({ page }, use) => use(new LoginPage(page)),
  customersPage: async ({ page }, use) => use(new CustomersPage(page)),
  customerDetailPage: async ({ page }, use) => use(new CustomerDetailPage(page)),
  customerContractsTab: async ({ page }, use) => use(new CustomerContractsTab(page)),
  contractDetailPage: async ({ page }, use) => use(new ContractDetailPage(page)),
  customerBookingsTab: async ({ page }, use) => use(new CustomerBookingsTab(page)),
  calendarPage: async ({ page }, use) => use(new CalendarPage(page)),
  sessionsPage: async ({ page }, use) => use(new SessionsPage(page)),
  trainersPage: async ({ page }, use) => use(new TrainersPage(page)),
  financePage: async ({ page }, use) => use(new FinancePage(page)),

  apiAs: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (role, { origin = baseURL ?? null } = {}) => {
      const context = await playwright.request.newContext({
        baseURL,
        storageState: role ? storageStatePath(role) : undefined,
        extraHTTPHeaders: origin ? { origin } : {},
      });
      contexts.push(context);
      return context;
    });
    await Promise.all(contexts.map((context) => context.dispose()));
  },

  testTag: async ({}, use) => {
    const tag = `E2E${randomUUID().slice(0, 8)}`;
    await use(tag);

    const prisma = connect();
    const ids = (rows: { id: string }[]) => rows.map((row) => row.id);
    try {
      const tagged = { fullName: { contains: tag } };
      const customerIds = ids(await prisma.customer.findMany({ where: tagged, select: { id: true } }));
      const trainerIds = ids(await prisma.trainer.findMany({ where: tagged, select: { id: true } }));
      const contractIds = ids(await prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } }));
      const bookingIds = ids(
        await prisma.booking.findMany({
          where: { OR: [{ customerId: { in: customerIds } }, { trainerId: { in: trainerIds } }] },
          select: { id: true },
        }),
      );
      const paymentIds = ids(await prisma.payment.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } }));
      const cashIds = ids(await prisma.cashTransaction.findMany({ where: { category: { contains: tag } }, select: { id: true } }));
      await prisma.session.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.cashTransaction.deleteMany({ where: { id: { in: cashIds } } });
      const audited = [...customerIds, ...contractIds, ...bookingIds, ...trainerIds, ...paymentIds, ...cashIds];
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: audited } } });
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.trainer.deleteMany({ where: { id: { in: trainerIds } } });
    } finally {
      await prisma.$disconnect();
    }
  },
});

/** Starts each test in the describe block signed in as `role` (session saved by auth.setup.ts). */
export function signedInAs(role: Role) {
  return { storageState: storageStatePath(role) };
}

export { expect };
