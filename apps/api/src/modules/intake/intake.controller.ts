import {
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
  createParamDecorator,
} from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import {
  intakeAnswerSchema,
  intakeSourceCreatedSchema,
  intakeSourceInputSchema,
  intakeSourceListSchema,
  intakeSourceSchema,
  intakeSourceUpdateSchema,
  websiteLeadSchema,
  whatsAppReceiptSchema,
} from "@flow/shared/intake";
import { CurrentActor, DeviceKeyEndpoint, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { AppError } from "../../platform/errors/app-error.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiResult } from "../../platform/http/openapi.js";
import { clientIp, logSecurityEvent } from "../../platform/security/log.js";
import {
  answerWhatsAppHandshake,
  authenticateSource,
  createSource,
  listSources,
  receiveWebsiteLead,
  receiveWhatsApp,
  rotateSourceKey,
  updateSource,
  withinRate,
  type AuthenticatedSource,
} from "./intake.service.js";

type SourceRequest = Request & { intakeSource?: AuthenticatedSource };

/**
 * Lets a registered, active source in by its key; anything else is a 401. The key is never logged (OWASP A09). A source sending
 * too fast is told to slow down (429).
 */
@Injectable()
export class SourceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SourceRequest>();
    const key = request.headers["x-intake-key"];
    const source = typeof key === "string" ? await authenticateSource(key) : null;
    if (!source) {
      logSecurityEvent("auth.unauthenticated", {
        method: request.method,
        path: request.path,
        ip: clientIp(fromNodeHeaders(request.headers)),
        reason: "intake key",
      });
      throw new AppError("UNAUTHENTICATED");
    }
    if (!withinRate(source.id)) {
      logSecurityEvent("intake.rate_limited", { sourceId: source.id }, "warn");
      throw new AppError("RATE_LIMITED");
    }
    request.intakeSource = source;
    return true;
  }
}

const CurrentSource = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedSource => {
  const source = context.switchToHttp().getRequest<SourceRequest>().intakeSource;
  if (!source) throw new AppError("UNAUTHENTICATED");
  return source;
});

/** What the connections call (brief §11, D-044; M10.1): each with its own key in `x-intake-key`, never a user session. */
@ApiTags("intake")
@ApiErrors()
@Controller("intake")
export class IntakeController {
  /** A submission of the website form: a lead, or an inquiry on the person who has the phone. */
  @Post("website")
  @DeviceKeyEndpoint()
  @UseGuards(SourceGuard)
  @HttpCode(200)
  @ApiResult(intakeAnswerSchema)
  async website(@CurrentSource() source: AuthenticatedSource, @Body({ schema: websiteLeadSchema }) body: unknown) {
    if (source.kind !== "WEBSITE") throw new AppError("FORBIDDEN");
    return encode(intakeAnswerSchema, await receiveWebsiteLead(source, body));
  }
}

type WebhookRequest = Request & { rawBody?: Buffer };

/**
 * What WhatsApp calls (M10.2): no session, no key header; the source is named in the path and proved by Meta's signature over
 * the body (checked in the service). A GET is Meta's handshake when the webhook is registered.
 */
@ApiTags("intake")
@ApiErrors()
@Controller("intake/whatsapp")
export class WhatsAppController {
  @Get(":sourceId")
  @DeviceKeyEndpoint()
  @Header("content-type", "text/plain; charset=utf-8")
  async handshake(@Param("sourceId") sourceId: string, @Query() query: Record<string, unknown>) {
    return answerWhatsAppHandshake(sourceId, query);
  }

  @Post(":sourceId")
  @DeviceKeyEndpoint()
  @HttpCode(200)
  @ApiResult(whatsAppReceiptSchema)
  async delivery(@Param("sourceId") sourceId: string, @Req() request: WebhookRequest, @Body() body: unknown) {
    const signature = request.headers["x-hub-signature-256"];
    const receipt = await receiveWhatsApp(
      sourceId,
      request.rawBody,
      typeof signature === "string" ? signature : undefined,
      body,
    );
    return encode(whatsAppReceiptSchema, receipt);
  }
}

/** The sources (M10.1): Admin registers one per connection and gets its key once. */
@ApiTags("intake")
@ApiErrors()
@Controller("intake/sources")
export class IntakeSourcesController {
  @Get()
  @RequirePermission("intake.manage")
  @ApiResult(intakeSourceListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(intakeSourceListSchema, await listSources(actor));
  }

  @Post()
  @RequirePermission("intake.manage")
  @ApiResult(intakeSourceCreatedSchema, 201)
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: intakeSourceInputSchema }) body: unknown) {
    return encode(intakeSourceCreatedSchema, await createSource(actor, body));
  }

  @Patch(":id")
  @RequirePermission("intake.manage")
  @ApiResult(intakeSourceSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: intakeSourceUpdateSchema }) body: unknown,
  ) {
    return encode(intakeSourceSchema, await updateSource(actor, id, body));
  }

  @Post(":id/key")
  @RequirePermission("intake.manage")
  @HttpCode(200)
  @ApiResult(intakeSourceCreatedSchema)
  async rotate(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(intakeSourceCreatedSchema, await rotateSourceKey(actor, id));
  }
}
