// The composition root for E2E specs: specs import `test` and `expect` from here,
// never from @playwright/test, and never construct page objects themselves.
import { randomInt, randomUUID } from "node:crypto";
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
import { LeadPage, LeadsPage, RecarePage } from "./pages/leads";
import { ChecklistAdminPage, TodayPage } from "./pages/checklist";
import { ScriptsAdminPage } from "./pages/scripts";
import { PromotionsPage } from "./pages/promotions";
import { ServiceDetailPage, ServicesPage } from "./pages/services";
import { LeadAuditPage } from "./pages/lead-audit";
import { LeadReceiversPage } from "./pages/lead-receivers";
import { ContractDetailPage, ContractListPage, CustomerContractsTab } from "./pages/contracts";
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
  contractListPage: ContractListPage;
  customerBookingsTab: CustomerBookingsTab;
  calendarPage: CalendarPage;
  sessionsPage: SessionsPage;
  employeesPage: EmployeesPage;
  tasksPage: TasksPage;
  leadsPage: LeadsPage;
  leadPage: LeadPage;
  recarePage: RecarePage;
  todayPage: TodayPage;
  checklistAdminPage: ChecklistAdminPage;
  scriptsAdminPage: ScriptsAdminPage;
  servicesPage: ServicesPage;
  promotionsPage: PromotionsPage;
  serviceDetailPage: ServiceDetailPage;
  leadAuditPage: LeadAuditPage;
  leadReceiversPage: LeadReceiversPage;
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
  contractListPage: async ({ page }, use) => use(new ContractListPage(page)),
  customerBookingsTab: async ({ page }, use) => use(new CustomerBookingsTab(page)),
  calendarPage: async ({ page }, use) => use(new CalendarPage(page)),
  sessionsPage: async ({ page }, use) => use(new SessionsPage(page)),
  employeesPage: async ({ page }, use) => use(new EmployeesPage(page)),
  tasksPage: async ({ page }, use) => use(new TasksPage(page)),
  leadsPage: async ({ page }, use) => use(new LeadsPage(page)),
  leadPage: async ({ page }, use) => use(new LeadPage(page)),
  recarePage: async ({ page }, use) => use(new RecarePage(page)),
  todayPage: async ({ page }, use) => use(new TodayPage(page)),
  checklistAdminPage: async ({ page }, use) => use(new ChecklistAdminPage(page)),
  scriptsAdminPage: async ({ page }, use) => use(new ScriptsAdminPage(page)),
  servicesPage: async ({ page }, use) => use(new ServicesPage(page)),
  promotionsPage: async ({ page }, use) => use(new PromotionsPage(page)),
  serviceDetailPage: async ({ page }, use) => use(new ServiceDetailPage(page)),
  leadAuditPage: async ({ page }, use) => use(new LeadAuditPage(page)),
  leadReceiversPage: async ({ page }, use) => use(new LeadReceiversPage(page)),
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
                action: step.action,
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
      // The sign-in limit is per IP and the whole suite shares one, so each account made
      // for a test signs in from its own address (the web app forwards X-Forwarded-For, T-053).
      // The rate-limit spec, which needs the shared address, signs in through apiAs.
      const address = `10.${randomInt(256)}.${randomInt(256)}.${1 + randomInt(254)}`;
      const context = await playwright.request.newContext({
        baseURL,
        extraHTTPHeaders: { origin: baseURL!, "x-forwarded-for": address },
      });
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
      // Notes on tagged leads (M2 slice 6), and scripts named with the tag with their history.
      await prisma.leadNote.deleteMany({ where: { personId: { in: customerIds } } });
      // Emails queued for tagged customers (M4.0); their failure tasks carry the tag in their title.
      await prisma.emailMessage.deleteMany({ where: { personId: { in: customerIds } } });
      // Manager audits of tagged leads (M3 slice 3), and of any lead naming a tagged option.
      const taggedOptions = ids(
        await prisma.option.findMany({ where: { labelVi: { contains: tag } }, select: { id: true } }),
      );
      const taggedAudits = ids(
        await prisma.consultingAudit.findMany({
          where: {
            OR: [{ personId: { in: customerIds } }, { criteria: { some: { optionId: { in: taggedOptions } } } }],
          },
          select: { id: true },
        }),
      );
      await prisma.consultingAuditCriterion.deleteMany({ where: { auditId: { in: taggedAudits } } });
      await prisma.consultingAudit.deleteMany({ where: { id: { in: taggedAudits } } });
      const scriptIds = ids(
        await prisma.consultingScript.findMany({ where: { situationVi: { contains: tag } }, select: { id: true } }),
      );
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: scriptIds } } });
      await prisma.consultingScript.deleteMany({ where: { id: { in: scriptIds } } });
      // Inquiries and merges (M2 slice 5): the merged records point at their survivors.
      await prisma.leadInquiry.deleteMany({ where: { personId: { in: customerIds } } });
      await prisma.personMerge.deleteMany({
        where: { OR: [{ survivorId: { in: customerIds } }, { mergedId: { in: customerIds } }] },
      });
      await prisma.customer.updateMany({
        where: { id: { in: customerIds }, mergedIntoId: { not: null } },
        data: { mergedIntoId: null, mergedAt: null },
      });
      await prisma.trashEntry.deleteMany({ where: { entityType: "person", entityId: { in: customerIds } } });
      await prisma.session.deleteMany({ where: { bookingId: { in: bookingIds } } });
      await prisma.booking.deleteMany({ where: { id: { in: bookingIds } } });
      // Teardown removes test data outright, outside the trash rules (docs/13).
      await prisma.trashEntry.deleteMany({ where: { entityId: { in: [...paymentIds, ...cashIds, ...contractIds] } } });
      await prisma.approvalRequest.deleteMany({
        where: { entityId: { in: [...paymentIds, ...cashIds, ...customerIds, ...contractIds] } },
      });
      await prisma.payment.deleteMany({ where: { id: { in: paymentIds } } });
      await prisma.cashTransaction.deleteMany({ where: { id: { in: cashIds } } });
      const audited = [...customerIds, ...contractIds, ...bookingIds, ...trainerIds, ...paymentIds, ...cashIds];
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: audited } } });
      await prisma.contract.deleteMany({ where: { id: { in: contractIds } } });
      // Promotions and vouchers named with the tag (their service links go with them).
      await prisma.promotion.deleteMany({ where: { name: { contains: tag } } });
      // Services named with the tag, with their price versions, tiers, and quick-pick counts (M4.1).
      const serviceIds = ids(
        await prisma.service.findMany({ where: { name: { contains: tag } }, select: { id: true } }),
      );
      const versionIds = ids(
        await prisma.priceTierVersion.findMany({ where: { serviceId: { in: serviceIds } }, select: { id: true } }),
      );
      await prisma.priceTier.deleteMany({ where: { versionId: { in: versionIds } } });
      await prisma.auditEvent.deleteMany({ where: { entityId: { in: [...serviceIds, ...versionIds] } } });
      await prisma.priceTierVersion.deleteMany({ where: { id: { in: versionIds } } });
      await prisma.service.deleteMany({ where: { id: { in: serviceIds } } });
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
      // Inquiries and merges the test's accounts made on other records.
      await prisma.leadInquiry.deleteMany({ where: { createdById: asUser } });
      await prisma.leadNote.deleteMany({ where: { createdBy: asUser } });
      const byAuditors = ids(
        await prisma.consultingAudit.findMany({ where: { auditorId: asUser }, select: { id: true } }),
      );
      await prisma.consultingAuditCriterion.deleteMany({ where: { auditId: { in: byAuditors } } });
      await prisma.consultingAudit.deleteMany({ where: { id: { in: byAuditors } } });
      await prisma.personMerge.deleteMany({ where: { mergedById: asUser } });
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
      await prisma.cashOpeningBalance.deleteMany({ where: { methodId: { in: taggedOptionIds } } });
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
