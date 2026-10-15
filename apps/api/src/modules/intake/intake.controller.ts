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
  Put,
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
  pageTokenInputSchema,
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
  answerMetaHandshake,
  authenticateSource,
  createSource,
  listSources,
  receiveWebsiteLead,
  receiveEmail,
  receiveMetaDelivery,
  receiveZalo,
  rotateSourceKey,
  setPageToken,
  updateSource,
  withinRate,
  type AuthenticatedSource,
} from "./intake.service.js";

type SourceRequest = Request & { intakeSource?: AuthenticatedSource };

/**
 * The key a source sends: in `x-intake-key` (the website form), or as the password of HTTP Basic authentication, which is how an
 * inbound-mail service carries credentials written in the webhook address (email, M10.5). The user name is not used.
 */
function sourceKey(headers: Request["headers"]): string | null {
  const key = headers["x-intake-key"];
  if (typeof key === "string") return key;
  const basic = /^Basic ([A-Za-z0-9+/=]{1,400})$/.exec(headers.authorization ?? "");
  if (!basic) return null;
  const decoded = Buffer.from(basic[1]!, "base64").toString("utf8");
  const colon = decoded.indexOf(":");
  return colon >= 0 ? decoded.slice(colon + 1) : null;
}

/**
 * Lets a registered, active source in by its key; anything else is a 401. The key is never logged (OWASP A09). A source sending
 * too fast is told to slow down (429).
 */
@Injectable()
export class SourceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<SourceRequest>();
    const key = sourceKey(request.headers);
    const source = key ? await authenticateSource(key) : null;
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

  /** An email forwarded from the gym's Gmail by the inbound-mail service (M10.5), its key as the Basic password. */
  @Post("email")
  @DeviceKeyEndpoint()
  @UseGuards(SourceGuard)
  @HttpCode(200)
  @ApiResult(whatsAppReceiptSchema)
  async email(@CurrentSource() source: AuthenticatedSource, @Body() body: unknown) {
    if (source.kind !== "EMAIL") throw new AppError("FORBIDDEN");
    return encode(whatsAppReceiptSchema, await receiveEmail(source, body));
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
    return answerMetaHandshake("whatsapp", sourceId, query);
  }

  @Post(":sourceId")
  @DeviceKeyEndpoint()
  @HttpCode(200)
  @ApiResult(whatsAppReceiptSchema)
  async delivery(@Param("sourceId") sourceId: string, @Req() request: WebhookRequest, @Body() body: unknown) {
    const signature = request.headers["x-hub-signature-256"];
    const receipt = await receiveMetaDelivery(
      "whatsapp",
      sourceId,
      request.rawBody,
      typeof signature === "string" ? signature : undefined,
      body,
    );
    return encode(whatsAppReceiptSchema, receipt);
  }
}

/**
 * What Messenger and Instagram call (M10.3): like WhatsApp, the source is named in the path and proved by Meta's signature over the
 * body; one address serves both kinds, the source says which.
 */
@ApiTags("intake")
@ApiErrors()
@Controller("intake/meta")
export class MessagingController {
  @Get(":sourceId")
  @DeviceKeyEndpoint()
  @Header("content-type", "text/plain; charset=utf-8")
  async handshake(@Param("sourceId") sourceId: string, @Query() query: Record<string, unknown>) {
    return answerMetaHandshake("meta", sourceId, query);
  }

  @Post(":sourceId")
  @DeviceKeyEndpoint()
  @HttpCode(200)
  @ApiResult(whatsAppReceiptSchema)
  async delivery(@Param("sourceId") sourceId: string, @Req() request: WebhookRequest, @Body() body: unknown) {
    const signature = request.headers["x-hub-signature-256"];
    const receipt = await receiveMetaDelivery(
      "meta",
      sourceId,
      request.rawBody,
      typeof signature === "string" ? signature : undefined,
      body,
    );
    return encode(whatsAppReceiptSchema, receipt);
  }
}

/**
 * What Zalo calls for the gym's OA (M10.6): the source is named in the path and proved by `X-ZEvent-Signature` over the body (checked
 * in the service). Zalo has no handshake.
 */
@ApiTags("intake")
@ApiErrors()
@Controller("intake/zalo")
export class ZaloController {
  @Post(":sourceId")
  @DeviceKeyEndpoint()
  @HttpCode(200)
  @ApiResult(whatsAppReceiptSchema)
  async event(@Param("sourceId") sourceId: string, @Req() request: WebhookRequest, @Body() body: unknown) {
    const signature = request.headers["x-zevent-signature"];
    const receipt = await receiveZalo(
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

  /** The Page token of a Messenger source, for its Lead Ads forms (M10.4); never returned. */
  @Put(":id/page-token")
  @RequirePermission("intake.manage")
  @ApiResult(intakeSourceSchema)
  async pageToken(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: pageTokenInputSchema }) body: unknown,
  ) {
    return encode(intakeSourceSchema, await setPageToken(actor, id, body));
  }
}
