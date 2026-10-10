import { Module } from "@nestjs/common";
import type { MiddlewareConsumer, NestModule } from "@nestjs/common";
import { APP_FILTER, APP_GUARD } from "@nestjs/core";
import { AuthGuard } from "./platform/auth/auth.guard.js";
import { MeController } from "./platform/auth/me.controller.js";
import { BranchesController } from "./platform/branches/branches.controller.js";
import { RolesController } from "./platform/roles/roles.controller.js";
import { ErrorFilter } from "./platform/http/error.filter.js";
import { requestGuards } from "./platform/http/request-guards.middleware.js";
import { BookingsController, ScheduleController } from "./modules/bookings/bookings.controller.js";
import { ContractsController } from "./modules/contracts/contracts.controller.js";
import { CustomersController } from "./modules/customers/customers.controller.js";
import { CashTransactionsController, DebtsController, PaymentsController } from "./modules/finance/finance.controller.js";
import { TrainersController } from "./modules/trainers/trainers.controller.js";
import { UsersController } from "./modules/users/users.controller.js";

// Controllers stay thin: they read the request, call a service, and encode the result
// with its shared schema. Services authorize, validate, and own transactions (docs/22).
@Module({
  controllers: [
    MeController,
    CustomersController,
    ContractsController,
    TrainersController,
    BookingsController,
    ScheduleController,
    PaymentsController,
    DebtsController,
    CashTransactionsController,
    UsersController,
    RolesController,
    BranchesController,
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
