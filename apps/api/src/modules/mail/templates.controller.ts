import { Body, Controller, Get, Param, Put } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { emailTemplateInputSchema, emailTemplateListSchema, emailTemplateSchema } from "@gymcrm/shared/mail";
import { CurrentActor, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { getTemplate, listTemplates, updateTemplate } from "./template.service.js";

/** The words of each customer email, in Vietnamese and English (M6.2, FR-MAIL-001): Admin edits them. */
@ApiTags("email-templates")
@ApiErrors()
@Controller("email-templates")
export class EmailTemplatesController {
  @Get()
  @RequirePermission("mail.template")
  @ApiResult(emailTemplateListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(emailTemplateListSchema, await listTemplates(actor));
  }

  @Get(":event")
  @RequirePermission("mail.template")
  @ApiResult(emailTemplateSchema)
  async get(@CurrentActor() actor: CurrentUser, @Param("event") event: string) {
    return encode(emailTemplateSchema, await getTemplate(actor, event));
  }

  /** A text may only use the placeholders its event offers, and must still tell what D-036 says it must. */
  @Put(":event")
  @RequirePermission("mail.template")
  @ApiResult(emailTemplateSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("event") event: string,
    @Body({ schema: emailTemplateInputSchema }) body: unknown,
  ) {
    return encode(emailTemplateSchema, await updateTemplate(actor, event, body));
  }
}
