import { Body, Controller, Get, HttpCode, Param, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { leadReceiverInputSchema, leadReceiverListSchema, leadReceiverSchema } from "@flow/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { listLeadReceivers, setLeadReceiver } from "./lead-receiver.service.js";

/** The consultants who receive leads, their turn weight, and the switch for receiving (D-050). */
@ApiTags("leads")
@ApiErrors()
@Controller("lead-receivers")
export class LeadReceiversController {
  @Get()
  @RequirePermission("lead.assign")
  @ApiResult(leadReceiverListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(leadReceiverListSchema, await listLeadReceivers(actor));
  }

  /** Switches receiving on or off and sets the turn weight; audited. */
  @Put(":userId")
  @RequirePermission("lead.assign")
  @HttpCode(200)
  @ApiResult(leadReceiverSchema)
  async set(
    @CurrentActor() actor: CurrentUser,
    @Param("userId") userId: string,
    @Body({ schema: leadReceiverInputSchema }) body: unknown,
  ) {
    return encode(leadReceiverSchema, await setLeadReceiver(actor, userId, body));
  }
}
