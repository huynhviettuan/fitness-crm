import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./platform/auth/auth.guard.js";
import { MeController } from "./platform/auth/me.controller.js";
import { BranchesController } from "./platform/branches/branches.controller.js";
import { RolesController } from "./platform/roles/roles.controller.js";
import { OptionListsController } from "./platform/options/options.controller.js";
import { ParametersController } from "./platform/parameters/parameters.controller.js";
import { AuditEventsController } from "./platform/audit/audit.controller.js";
import { TrashController } from "./platform/trash/trash.controller.js";
import { ApprovalRulesController, ApprovalsController } from "./modules/approvals/approvals.controller.js";
import { ErrorFilter } from "./platform/http/error.filter.js";
import { requestGuards } from "./platform/http/request-guards.middleware.js";
import { BookingsController, ScheduleController } from "./modules/bookings/bookings.controller.js";
import { CheckinController, CheckinDevicesController } from "./modules/checkin/checkin.controller.js";
import { ClassSessionsController, ClassesController } from "./modules/classes/classes.controller.js";
import {
  NotificationPreferencesController,
  NotificationSettingsController,
  PushController,
} from "./platform/notifications/staff-notifications.controller.js";
import {
  WorkoutAreasController,
  WorkoutEquipmentController,
  WorkoutExercisesController,
  WorkoutStagesController,
} from "./modules/workouts/catalog.controller.js";
import { PayoutsController } from "./modules/payouts/payouts.controller.js";
import { EmailTemplatesController } from "./modules/mail/templates.controller.js";
import { ContractsController } from "./modules/contracts/contracts.controller.js";
import { CustomersController } from "./modules/customers/customers.controller.js";
import { LeadsController } from "./modules/leads/leads.controller.js";
import { PersonsController } from "./modules/leads/persons.controller.js";
import { ChecklistController } from "./modules/leads/checklist.controller.js";
import { ScriptsController } from "./modules/scripts/scripts.controller.js";
import { ServicesController } from "./modules/services/services.controller.js";
import { PromotionsController, QuoteController } from "./modules/promotions/promotions.controller.js";
import { LeadAuditController } from "./modules/leads/lead-audit.controller.js";
import { LeadReceiversController } from "./modules/leads/lead-receivers.controller.js";
import { ManagerAuditController } from "./modules/leads/manager-audit.controller.js";
import { ReportsController } from "./modules/reports/reports.controller.js";
import { SessionStatusesController } from "./modules/sessions/session-statuses.controller.js";
import { FilesController } from "./platform/files/files.controller.js";
import {
  CashTransactionsController,
  DebtsController,
  PaymentsController,
} from "./modules/finance/finance.controller.js";
import { EmployeesController } from "./modules/employees/employees.controller.js";
import { UsersController } from "./modules/users/users.controller.js";
import { TasksController } from "./modules/tasks/tasks.controller.js";
import { NotificationsController } from "./platform/notifications/notifications.controller.js";

// Controllers stay thin: they read the request, call a service, and encode the result
// with its shared schema. Services authorize, validate, and own transactions (docs/22).
@Module({
  controllers: [
    MeController,
    LeadsController,
    PersonsController,
    ChecklistController,
    ScriptsController,
    ServicesController,
    PromotionsController,
    QuoteController,
    LeadAuditController,
    LeadReceiversController,
    ManagerAuditController,
    ReportsController,
    FilesController,
    SessionStatusesController,
    CustomersController,
    ContractsController,
    EmployeesController,
    BookingsController,
    ScheduleController,
    CheckinController,
    CheckinDevicesController,
    ClassesController,
    ClassSessionsController,
    PayoutsController,
    WorkoutEquipmentController,
    WorkoutAreasController,
    WorkoutExercisesController,
    WorkoutStagesController,
    NotificationPreferencesController,
    NotificationSettingsController,
    PushController,
    EmailTemplatesController,
    PaymentsController,
    DebtsController,
    CashTransactionsController,
    UsersController,
    RolesController,
    BranchesController,
    OptionListsController,
    ParametersController,
    AuditEventsController,
    TrashController,
    ApprovalsController,
    ApprovalRulesController,
    TasksController,
    NotificationsController,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_FILTER, useClass: ErrorFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(requestGuards).forRoutes("*path");
  }
}
