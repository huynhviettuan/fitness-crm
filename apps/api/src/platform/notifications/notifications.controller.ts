import { Controller, Get, HttpCode, Param, Post, Req } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { notificationPageSchema, notificationSummarySchema } from "@flow/shared/notifications";
import { AnySignedInUser, CurrentActor } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../http/openapi.js";
import { queryOf } from "../http/query.js";
import { listNotifications, markAllRead, markRead, notificationSummary } from "./notification.service.js";

/** The signed-in user's own notifications (FR-PLT-009); nobody reads another's. */
@ApiTags("notifications")
@ApiErrors()
@Controller("notifications")
export class NotificationsController {
  @Get()
  @AnySignedInUser()
  @ApiOptionalQuery("unreadOnly", "page", "pageSize")
  @ApiResult(notificationPageSchema)
  async list(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(notificationPageSchema, await listNotifications(actor, queryOf(request, ["unreadOnly", "page", "pageSize"])));
  }

  /** The unread count for the bell in the top bar. */
  @Get("summary")
  @AnySignedInUser()
  @ApiResult(notificationSummarySchema)
  async summary(@CurrentActor() actor: CurrentUser) {
    return encode(notificationSummarySchema, await notificationSummary(actor));
  }

  @Post("read-all")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Every notification of the user is read" })
  async readAll(@CurrentActor() actor: CurrentUser): Promise<void> {
    await markAllRead(actor);
  }

  @Post(":id/read")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "Read" })
  async read(@CurrentActor() actor: CurrentUser, @Param("id") id: string): Promise<void> {
    await markRead(actor, id);
  }
}
