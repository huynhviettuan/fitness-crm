import { Body, Controller, Get, Headers, HttpCode, Put, Post } from "@nestjs/common";
import { ApiNoContentResponse, ApiTags } from "@nestjs/swagger";
import {
  notificationPreferencesInputSchema,
  notificationPreferencesSchema,
  notificationSettingsInputSchema,
  notificationSettingsSchema,
  pushKeySchema,
  pushRemoveInputSchema,
  pushSubscriptionInputSchema,
} from "@flow/shared/notifications";
import { AnySignedInUser, CurrentActor, RequirePermission } from "../auth/auth.guard.js";
import type { CurrentUser } from "../auth/session.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import {
  getPreferences,
  getSettings,
  pushKey,
  removeSubscription,
  savePreferences,
  saveSettings,
  saveSubscription,
} from "./delivery.service.js";

/** The signed-in employee's own choices for the notifications that reach them by email and on their phone (M6.4, D-053). */
@ApiTags("notifications")
@ApiErrors()
@Controller("notification-preferences")
export class NotificationPreferencesController {
  @Get()
  @AnySignedInUser()
  @ApiResult(notificationPreferencesSchema)
  async get(@CurrentActor() actor: CurrentUser) {
    return encode(notificationPreferencesSchema, await getPreferences(actor));
  }

  @Put()
  @AnySignedInUser()
  @ApiResult(notificationPreferencesSchema)
  async save(@CurrentActor() actor: CurrentUser, @Body({ schema: notificationPreferencesInputSchema }) body: unknown) {
    return encode(notificationPreferencesSchema, await savePreferences(actor, body));
  }
}

/** Admin marks which notifications are mandatory by email and by push (D-053). */
@ApiTags("notifications")
@ApiErrors()
@Controller("notification-settings")
export class NotificationSettingsController {
  @Get()
  @RequirePermission("config.manage")
  @ApiResult(notificationSettingsSchema)
  async get(@CurrentActor() actor: CurrentUser) {
    return encode(notificationSettingsSchema, await getSettings(actor));
  }

  @Put()
  @RequirePermission("config.manage")
  @ApiResult(notificationSettingsSchema)
  async save(@CurrentActor() actor: CurrentUser, @Body({ schema: notificationSettingsInputSchema }) body: unknown) {
    return encode(notificationSettingsSchema, await saveSettings(actor, body));
  }
}

/** The devices a push can reach: the key to subscribe with, and adding and removing the signed-in employee's own. */
@ApiTags("notifications")
@ApiErrors()
@Controller("push")
export class PushController {
  @Get("key")
  @AnySignedInUser()
  @ApiResult(pushKeySchema)
  key() {
    return encode(pushKeySchema, pushKey());
  }

  @Put("subscription")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "The device is remembered" })
  async subscribe(
    @CurrentActor() actor: CurrentUser,
    @Body({ schema: pushSubscriptionInputSchema }) body: unknown,
    @Headers("user-agent") userAgent: string | undefined,
  ) {
    await saveSubscription(actor, body, userAgent);
  }

  @Post("unsubscribe")
  @AnySignedInUser()
  @HttpCode(204)
  @ApiNoContentResponse({ description: "The device is forgotten" })
  async unsubscribe(@CurrentActor() actor: CurrentUser, @Body({ schema: pushRemoveInputSchema }) body: unknown) {
    await removeSubscription(actor, body);
  }
}
