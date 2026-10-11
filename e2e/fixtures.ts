// The composition root for E2E specs: specs import `test` and `expect` from here,
// never from @playwright/test, and never construct page objects themselves.
import { randomUUID } from "node:crypto";
import { test as base, expect, type APIRequestContext } from "@playwright/test";
import type { Role } from "./support/db";
import { BranchesPage, RolesPage, UserDetailPage } from "./pages/admin";
import { AppShell } from "./pages/app-shell";
import { OptionListsPage, ParametersPage } from "./pages/configuration";
import { AuditPage, TrashPage } from "./pages/history";
import { ApprovalRulesPage, ApprovalsPage } from "./pages/approvals";
import { CalendarPage, CustomerBookingsTab, SessionsPage } from "./pages/bookings";
import { EmployeePage, EmployeesPage } from "./pages/employees";
import { NotificationsPage, TaskPage, TasksPage } from "./pages/tasks";
import { LeadPage, LeadsPage } from "./pages/leads";
import { ChecklistAdminPage, TodayPage } from "./pages/checklist";
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
  employeesPage: EmployeesPage;
  tasksPage: TasksPage;
  leadsPage: LeadsPage;
  leadPage: LeadPage;
  todayPage: TodayPage;
  checklistAdminPage: ChecklistAdminPage;
  taskPage: TaskPage;
  notificationsPage: NotificationsPage;
  employeePage: EmployeePage;
  financePage: FinancePage;
  branchesPage: BranchesPage;
  rolesPage: RolesPage;
  userDetailPage: UserDetailPage;
  optionListsPage: OptionListsPage;
  parametersPage: ParametersPage;
  trashPage: TrashPage;
  auditPage: AuditPage;
  approvalsPage: ApprovalsPage;
  approvalRulesPage: ApprovalRulesPage;
  /**
   * For a test that changes system parameters (T-049): they are global, so teardown
   * puts back exactly what was there before the test.
   */
  restoresParameters: void;
  /**
   * For a test that saves the consulting checklist (D-020). Versions are never changed,
   * so teardown saves the checklist as it was as the newest version again.
   */
  restoresChecklist: void;
  /** Like restoresParameters, for a test that edits the approval matrix (D-018). */
  restoresApprovalRules: void;
  /**
   * A unique marker for names this test creates. Teardown deletes every customer and
   * trainer whose name contains it, with their contracts, bookings, and payments, and
   * every cash transaction whose category, note, or reference contains it, even if the
   * test failed halfway. Leads go with their journey. Users, roles, branches, and options
   * whose name contains it go too.
   */
  testTag: string;
  /**
   * A raw HTTP client, signed in as `role` (or anonymous with null). By default it
   * sends the app's own Origin, like a browser on the app would; pass `origin` to
   * act as another site, or null to send none. Disposed after the test.
   */
  apiAs: (role: Role | null, options?: { origin?: string | null }) => Promise<APIRequestContext>;
  /** Like apiAs, for an account the test created: signs in with its email and password. */
  apiSignedIn: (email: string, password: string) => Promise<APIRequestContext>;
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
  employeesPage: async ({ page }, use) => use(new EmployeesPage(page)),
  tasksPage: async ({ page }, use) => use(new TasksPage(page)),
  leadsPage: async ({ page }, use) => use(new LeadsPage(page)),
  leadPage: async ({ page }, use) => use(new LeadPage(page)),
  todayPage: async ({ page }, use) => use(new TodayPage(page)),
  checklistAdminPage: async ({ page }, use) => use(new ChecklistAdminPage(page)),
  taskPage: async ({ page }, use) => use(new TaskPage(page)),
  notificationsPage: async ({ page }, use) => use(new NotificationsPage(page)),
  employeePage: async ({ page }, use) => use(new EmployeePage(page)),
  financePage: async ({ page }, use) => use(new FinancePage(page)),
  branchesPage: async ({ page }, use) => use(new BranchesPage(page)),
  rolesPage: async ({ page }, use) => use(new RolesPage(page)),
  userDetailPage: async ({ page }, use) => use(new UserDetailPage(page)),
  optionListsPage: async ({ page }, use) => use(new OptionListsPage(page)),
  parametersPage: async ({ page }, use) => use(new ParametersPage(page)),
  trashPage: async ({ page }, use) => use(new TrashPage(page)),
  auditPage: async ({ page }, use) => use(new AuditPage(page)),
  approvalsPage: async ({ page }, use) => use(new ApprovalsPage(page)),
  approvalRulesPage: async ({ page }, use) => use(new ApprovalRulesPage(page)),

  restoresApprovalRules: async ({}, use) => {
    const prisma = connect();
    try {
      const before = await prisma.approvalRule.findMany({ include: { approvers: true } });
      await use();
      for (const rule of before) {
        await prisma.approvalRule.update({
          where: { id: rule.id },
          data: { required: rule.required, overdueHours: rule.overdueHours },
        });
        await prisma.approvalRuleRole.deleteMany({ where: { actionType: rule.actionType } });
        await prisma.approvalRuleRole.createMany({
          data: rule.approvers.map((a) => ({ actionType: a.actionType, roleId: a.roleId })),
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  },

  restoresChecklist: async ({}, use) => {
    const prisma = connect();
    try {
      const latest = () =>
        prisma.consultingChecklist.findFirstOrThrow({ orderBy: { version: "desc" }, include: { steps: true } });
      const before = await latest();
      await use();
      const after = await latest();
      if (after.version !== before.version) {
        await prisma.consultingChecklist.create({
          data: {
            version: after.version + 1,
            steps: {
              create: before.steps.map((step) => ({
                sortOrder: step.sortOrder,
                key: step.key,
                labelVi: step.labelVi,
                labelEn: step.labelEn,
                trigger: step.trigger,
                triggerStatus: step.triggerStatus,
                triggerStepKey: step.triggerStepKey,
                offsetMinutes: step.offsetMinutes,
                required: step.required,
                autoComplete: step.autoComplete,
                results: step.results ?? [],
              })),
            },
          },
        });
      }
    } finally {
      await prisma.$disconnect();
    }
  },

  restoresParameters: async ({}, use) => {
    const prisma = connect();
    try {
      const before = await prisma.systemParameter.findMany({ select: { key: true, value: true } });
      await use();
      await prisma.systemParameter.deleteMany();
      for (const row of before)
        await prisma.systemParameter.create({ data: { key: row.key, value: row.value as string } });
    } finally {
      await prisma.$disconnect();
    }
  },

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

  apiSignedIn: async ({ playwright, baseURL }, use) => {
    const contexts: APIRequestContext[] = [];
    await use(async (email, password) => {
      const context = await playwright.request.newContext({ baseURL, extraHTTPHeaders: { origin: baseURL! } });
      contexts.push(context);
      const response = await context.post("/api/auth/sign-in/email", { data: { email, password } });
      if (!response.ok()) throw new Error(`Sign-in as ${email} failed: ${response.status()}`);
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
      // Employees, trainers among them; their shifts and days off go with them (cascade).
      const trainerIds = ids(await prisma.employee.findMany({ where: tagged, select: { id: true } }));
      const contractIds = ids(
        await prisma.contract.findMany({ where: { customerId: { in: customerIds } }, select: { id: true } }),
      );
      const bookingIds = ids(
        await prisma.booking.findMany({
          where: { OR: [{ customerId: { in: customerIds } }, { trainerId: { in: trainerIds } }] },
          select: { id: true },
        }),
      );
      const paymentIds = ids(
        await prisma.payment.findMany({ where: { contractId: { in: contractIds } }, select: { id: true } }),
      );
      const taggedOptionIds = ids(
        await prisma.option.findMany({ where: { labelVi: { contains: tag } }, select: { id: true } }),
      );
      const cashIds = ids(
        await prisma.cashTransaction.findMany({
          where: {
            OR: [
              { categoryId: { in: taggedOptionIds } },
              { categoryNote: { contains: tag } },
              { reference: { contains: tag } },
            ],
          },
          select: { id: true },
        }),
      );
      // Tasks titled with the tag, with their comments and history; notifications about them.
      const taskIds = ids(await prisma.task.findMany({ where: { title: { contains: tag } }, select: { id: true } }));
      await prisma.taskComment.deleteMany({ where: { taskId: { in: taskIds } } });
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: taskIds } } });
      await prisma.task.deleteMany({ where: { id: { in: taskIds } } });
      await prisma.notification.deleteMany({ where: { params: { path: ["title"], string_contains: tag } } });
      // Notifications about tagged leads (their name), and the leads' journey (D-020).
      await prisma.notification.deleteMany({ where: { params: { path: ["name"], string_contains: tag } } });
      await prisma.leadStatusChange.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.leadStep.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.leadAssignment.deleteMany({ where: { customerId: { in: customerIds } } });
      await prisma.session.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      // Teardown removes test data outright, outside the trash rules (docs/13).
      await prisma.trashEntry.deleteMany({ where: { entityId: { in: [...paymentIds, ...cashIds] } } });
      await prisma.approvalRequest.deleteMany({
        where: { entityId: { in: [...paymentIds, ...cashIds, ...customerIds] } },
      });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.cashTransaction.deleteMany({ where: { id: { in: cashIds } } });
      const audited = [...customerIds, ...contractIds, ...bookingIds, ...trainerIds, ...paymentIds, ...cashIds];
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: audited } } });
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
      await prisma.employee.deleteMany({ where: { id: { in: trainerIds } } });

      // Accounts, roles, and branches the test created. Their sign-ins, grants, and
      // overrides go with them (cascade); audit events they wrote first (restricted).
      const userIds = ids(await prisma.user.findMany({ where: { name: { contains: tag } }, select: { id: true } }));
      await prisma.auditEvent.deleteMany({
        where: { OR: [{ actorUserId: { in: userIds } }, { entityId: { in: userIds } }] },
      });
      await prisma.approvalRequest.deleteMany({
        where: { OR: [{ submittedById: { in: userIds } }, { decidedById: { in: userIds } }] },
      });
      // Their part in other leads' journeys (restricted), and the round-robin's memory of them.
      const asUser = { in: userIds };
      await prisma.leadStatusChange.updateMany({ where: { changedById: asUser }, data: { changedById: null } });
      await prisma.leadStep.updateMany({ where: { doneById: asUser }, data: { doneById: null } });
      await prisma.leadAssignment.deleteMany({
        where: { OR: [{ fromUserId: asUser }, { toUserId: asUser }, { assignedById: asUser }] },
      });
      await prisma.customer.updateMany({ where: { picUserId: asUser }, data: { picUserId: null } });
      await prisma.leadRoundRobin.deleteMany({ where: { lastUserId: asUser } });
      await prisma.user.deleteMany({ where: { id: { in: userIds } } });
      const roleIds = ids(await prisma.role.findMany({ where: { name: { contains: tag } }, select: { id: true } }));
      const branchIds = ids(await prisma.branch.findMany({ where: { name: { contains: tag } }, select: { id: true } }));
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...roleIds, ...branchIds] } } });
      await prisma.role.deleteMany({ where: { id: { in: roleIds } } });
      await prisma.leadRoundRobin.deleteMany({ where: { branchId: { in: branchIds } } });
      await prisma.branch.deleteMany({ where: { id: { in: branchIds } } });

      // Options the test added, once nothing uses them.
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: taggedOptionIds } } });
      await prisma.option.deleteMany({ where: { id: { in: taggedOptionIds } } });
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
