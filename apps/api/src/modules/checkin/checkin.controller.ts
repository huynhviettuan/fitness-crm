import {
  Body,
  type CanActivate,
  Controller,
  type ExecutionContext,
  Get,
  HttpCode,
  Injectable,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
  createParamDecorator,
} from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Request } from "express";
import { z } from "zod";
import {
  MACHINE_SUBJECTS,
  deviceCreatedSchema,
  deviceInputSchema,
  deviceListSchema,
  deviceIdentitySchema,
  deviceSchema,
  deviceUpdateSchema,
  hangingListSchema,
  machineCodeSchema,
  machineCodeViewSchema,
  manualReportSchema,
  scanPageSchema,
  scansAnswerSchema,
  scansInputSchema,
} from "@flow/shared/checkin";
import { CurrentActor, DeviceKeyEndpoint, RequirePermission } from "../../platform/auth/auth.guard.js";
import type { CurrentUser } from "../../platform/auth/session.js";
import { AppError } from "../../platform/errors/app-error.js";
import { encode } from "../../platform/http/encode.js";
import { ApiErrors, ApiOptionalQuery, ApiResult } from "../../platform/http/openapi.js";
import { queryOf } from "../../platform/http/query.js";
import { clientIp, logSecurityEvent } from "../../platform/security/log.js";
import { fromNodeHeaders } from "better-auth/node";
import {
  getMachineCode,
  listHanging,
  listScans,
  manualConfirmationReport,
  requestManualConfirmation,
  setMachineCode,
} from "./checkin.service.js";
import {
  authenticateDevice,
  createDevice,
  describeDevice,
  listDevices,
  rotateDeviceKey,
  updateDevice,
} from "./device.service.js";
import type { AuthenticatedDevice } from "./device.service.js";
import { receiveScans } from "./scan.service.js";

type DeviceRequest = Request & { device?: AuthenticatedDevice };

/** Lets a registered, active machine in by its key; anything else is a 401 (D-072). The key is never logged. */
@Injectable()
export class DeviceGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<DeviceRequest>();
    const key = request.headers["x-device-key"];
    const device = typeof key === "string" ? await authenticateDevice(key) : null;
    if (!device) {
      logSecurityEvent("auth.unauthenticated", {
        method: request.method,
        path: request.path,
        ip: clientIp(fromNodeHeaders(request.headers)),
        reason: "device key",
      });
      throw new AppError("UNAUTHENTICATED");
    }
    request.device = device;
    return true;
  }
}

const CurrentDevice = createParamDecorator((_data: unknown, context: ExecutionContext): AuthenticatedDevice => {
  const device = context.switchToHttp().getRequest<DeviceRequest>().device;
  if (!device) throw new AppError("UNAUTHENTICATED");
  return device;
});

const subjectSchema = z.enum(MACHINE_SUBJECTS);
const subjectOf = (value: string) => {
  const parsed = subjectSchema.safeParse(value);
  if (!parsed.success) throw new AppError("NOT_FOUND");
  return parsed.data;
};

/** The machines (M5.3b, D-072): Admin registers one per branch and gets its key once. */
@ApiTags("checkin")
@ApiErrors()
@Controller("checkin/devices")
export class CheckinDevicesController {
  @Get()
  @RequirePermission("checkin.devices")
  @ApiResult(deviceListSchema)
  async list(@CurrentActor() actor: CurrentUser) {
    return encode(deviceListSchema, await listDevices(actor));
  }

  @Post()
  @RequirePermission("checkin.devices")
  @ApiResult(deviceCreatedSchema, 201)
  async create(@CurrentActor() actor: CurrentUser, @Body({ schema: deviceInputSchema }) body: unknown) {
    return encode(deviceCreatedSchema, await createDevice(actor, body));
  }

  @Patch(":id")
  @RequirePermission("checkin.devices")
  @ApiResult(deviceSchema)
  async update(
    @CurrentActor() actor: CurrentUser,
    @Param("id") id: string,
    @Body({ schema: deviceUpdateSchema }) body: unknown,
  ) {
    return encode(deviceSchema, await updateDevice(actor, id, body));
  }

  @Post(":id/key")
  @RequirePermission("checkin.devices")
  @HttpCode(200)
  @ApiResult(deviceCreatedSchema)
  async rotate(@CurrentActor() actor: CurrentUser, @Param("id") id: string) {
    return encode(deviceCreatedSchema, await rotateDeviceKey(actor, id));
  }
}

@ApiTags("checkin")
@ApiErrors()
@Controller("checkin")
export class CheckinController {
  /**
   * Which machine a key belongs to (M5.8b, A-310): the bridge asks at start-up and when its settings are checked, so a wrong or
   * replaced key shows before the first scan. Authenticated by `x-device-key`; changes nothing.
   */
  @Get("device")
  @DeviceKeyEndpoint()
  @UseGuards(DeviceGuard)
  @ApiResult(deviceIdentitySchema)
  async device(@CurrentDevice() device: AuthenticatedDevice) {
    return encode(deviceIdentitySchema, await describeDevice(device));
  }

  /** What a machine sends: its scans, each with the real time of the scan. Authenticated by `x-device-key`. */
  @Post("scans")
  @DeviceKeyEndpoint()
  @UseGuards(DeviceGuard)
  @HttpCode(200)
  @ApiResult(scansAnswerSchema)
  async receive(@CurrentDevice() device: AuthenticatedDevice, @Body({ schema: scansInputSchema }) body: unknown) {
    return encode(scansAnswerSchema, await receiveScans(device, body));
  }

  @Get("scans")
  @RequirePermission("checkin.review")
  @ApiOptionalQuery("result", "page", "pageSize")
  @ApiResult(scanPageSchema)
  async scans(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(scanPageSchema, await listScans(actor, queryOf(request, ["result", "page", "pageSize"])));
  }

  /** Sessions that lack a pair; a PT sees their own (D-071). */
  @Get("hanging")
  @RequirePermission("booking.view")
  @ApiResult(hangingListSchema)
  async hanging(@CurrentActor() actor: CurrentUser) {
    return encode(hangingListSchema, await listHanging(actor));
  }

  /** The PT says the customer trained but did not scan (D-071). */
  @Post("hanging/:bookingId/request")
  @RequirePermission("booking.manage")
  @HttpCode(204)
  async request(@CurrentActor() actor: CurrentUser, @Param("bookingId") bookingId: string) {
    await requestManualConfirmation(actor, bookingId);
  }

  @Get("manual-confirmations")
  @RequirePermission("report.manualConfirmations")
  @ApiOptionalQuery("from", "to")
  @ApiResult(manualReportSchema)
  async manual(@CurrentActor() actor: CurrentUser, @Req() request: Request) {
    return encode(manualReportSchema, await manualConfirmationReport(actor, queryOf(request, ["from", "to"])));
  }

  @Get("machine-codes/:subject/:id")
  @RequirePermission("checkin.devices")
  @ApiResult(machineCodeViewSchema)
  async machineCode(@CurrentActor() actor: CurrentUser, @Param("subject") subject: string, @Param("id") id: string) {
    return encode(machineCodeViewSchema, await getMachineCode(actor, subjectOf(subject), id));
  }

  @Put("machine-codes/:subject/:id")
  @RequirePermission("checkin.devices")
  @ApiResult(machineCodeViewSchema)
  async setMachineCode(
    @CurrentActor() actor: CurrentUser,
    @Param("subject") subject: string,
    @Param("id") id: string,
    @Body({ schema: machineCodeSchema }) body: unknown,
  ) {
    return encode(machineCodeViewSchema, await setMachineCode(actor, subjectOf(subject), id, body));
  }
}
