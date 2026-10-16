import { Body, Controller, Get, HttpCode, Param, Post } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import {
  inquiryResultSchema,
  leadInquiryInputSchema,
  mergeInputSchema,
  mergeResultSchema,
  personIntakeHistorySchema,
} from "@gymcrm/shared/leads";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { messageListSchema } from "@gymcrm/shared/intake";
import { listMessages } from "../intake/intake.service.js";
import { addInquiry, personIntakeHistory } from "./lead-inquiry.service.js";
import { mergePersons } from "./lead-merge.service.js";

/** One person, one record (D-019): what applies to a lead and to the customer it became. */
@ApiTags("persons")
@ApiErrors()
@Controller("persons")
export class PersonsController {
  /**
   * Merges two records of one person (BR-202, A-064): `:id` and `mergedId`; the customer
   * survives, or of two leads the older one. Two customers are MERGE_CUSTOMERS_UNSUPPORTED
   * (OQ-033); a record already merged is PERSON_ALREADY_MERGED; the record itself is a
   * VALIDATION_FAILED. The other record goes to the trash with the reason.
   */
  @Post(":id/merge")
  @RequirePermission("lead.merge")
  @HttpCode(200)
  @ApiResult(mergeResultSchema)
  async merge(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: mergeInputSchema }) body: unknown,
  ) {
    return encode(mergeResultSchema, await mergePersons(actor, id, body));
  }

  /**
   * The person wrote or came in again (BR-202, FR-LEAD-009, A-063): adds an inquiry to the
   * lead or customer record, which the actor must be able to see; no person is created.
   */
  @Post(":id/inquiries")
  @RequirePermission("lead.create")
  @ApiResult(inquiryResultSchema, 201, "Created")
  async addInquiry(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: leadInquiryInputSchema }) body: unknown,
  ) {
    return encode(inquiryResultSchema, await addInquiry(actor, id, body));
  }

  /** The conversation the connections stored on a lead or customer, oldest first (M10.1, A-266). */
  @Get(":id/messages")
  @RequirePermission("lead.view")
  @ApiResult(messageListSchema)
  async messages(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(messageListSchema, await listMessages(actor, id));
  }

  /** Inquiries and merges of a lead or customer, newest first (the customer page has no lead timeline). */
  @Get(":id/intake-history")
  @RequirePermission("lead.view")
  @ApiResult(personIntakeHistorySchema)
  async intakeHistory(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(personIntakeHistorySchema, await personIntakeHistory(actor, id));
  }
}
