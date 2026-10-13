import { Injectable, SetMetadata, applyDecorators, createParamDecorator } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import { ApiExtension } from "@nestjs/swagger";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import type { Permission } from "@flow/shared/permissions";
import { AppError } from "../errors/app-error.js";
import { assertCanAny } from "../permissions/assert.js";
import { clientIp, logSecurityEvent } from "../security/log.js";
import { getSessionUser, type CurrentUser } from "./session.js";

type AuthenticatedRequest = Request & { user?: CurrentUser };

const PERMISSION_METADATA = "flow:permission";
/** Declared by endpoints any signed-in user may call (their own profile). */
export const ANY_SIGNED_IN_USER = "authenticated";

/**
 * T-046: the permission an endpoint needs (any one of several, when given more). The
 * guard checks it before the handler runs; the OpenAPI document shows it as
 * `x-permission`. Services check it again, with data scope, so a service called from
 * elsewhere is never open.
 */
export function RequirePermission(...permissions: [Permission, ...Permission[]]) {
  return applyDecorators(
    SetMetadata(PERMISSION_METADATA, permissions),
    ApiExtension("x-permission", permissions.join(" | ")),
  );
}

/** Declared by the endpoint a registered check-in machine calls with its own key instead of a session (M5.3b, D-072). */
export const DEVICE_KEY = "device-key";

/** The endpoint is called by a machine; `DeviceGuard` checks its key, and no user session is needed. */
export function DeviceKeyEndpoint() {
  return applyDecorators(SetMetadata(PERMISSION_METADATA, DEVICE_KEY), ApiExtension("x-permission", DEVICE_KEY));
}

/** For endpoints about the signed-in user themselves. */
export function AnySignedInUser() {
  return applyDecorators(
    SetMetadata(PERMISSION_METADATA, ANY_SIGNED_IN_USER),
    ApiExtension("x-permission", ANY_SIGNED_IN_USER),
  );
}

/**
 * Every /api/v1 endpoint needs a signed-in, active user inside their access hours
 * (T-017, D-017), and the permission it declares (T-046). The user, their role, and
 * overrides are read from the database on each request, so changes take effect at once.
 * An endpoint that declares nothing is refused: forgetting is never an open door.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    // A machine endpoint is guarded by its own guard, which checks the device key (D-072).
    if (Reflect.getMetadata(PERMISSION_METADATA, context.getHandler()) === DEVICE_KEY) return true;
    const headers = fromNodeHeaders(request.headers);
    const user = await getSessionUser(headers);
    if (!user) {
      logSecurityEvent(
        "auth.unauthenticated",
        { method: request.method, path: request.path, ip: clientIp(headers) },
        "info",
      );
      throw new AppError("UNAUTHENTICATED");
    }
    request.user = user;

    const required = Reflect.getMetadata(PERMISSION_METADATA, context.getHandler()) as
      Permission[] | typeof ANY_SIGNED_IN_USER | undefined;
    if (required === undefined) {
      logSecurityEvent("authz.denied", {
        userId: user.id,
        path: request.path,
        reason: "endpoint declares no permission",
      });
      throw new AppError("FORBIDDEN");
    }
    if (required !== ANY_SIGNED_IN_USER) assertCanAny(user, required);
    return true;
  }
}

/** The signed-in user, as set by AuthGuard. Services authorize with it. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
});
