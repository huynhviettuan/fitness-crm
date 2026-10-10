import { Injectable, createParamDecorator } from "@nestjs/common";
import type { CanActivate, ExecutionContext } from "@nestjs/common";
import type { Request } from "express";
import { fromNodeHeaders } from "better-auth/node";
import { AppError } from "../errors/app-error.js";
import { clientIp, logSecurityEvent } from "../security/log.js";
import { getSessionUser, type CurrentUser } from "./session.js";

type AuthenticatedRequest = Request & { user?: CurrentUser };

/**
 * Every /api/v1 endpoint needs a signed-in, active user (T-017). The user is read from
 * the database on each request, so disabling an account takes effect at once.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const headers = fromNodeHeaders(request.headers);
    const user = await getSessionUser(headers);
    if (!user) {
      logSecurityEvent("auth.unauthenticated", { method: request.method, path: request.path, ip: clientIp(headers) }, "info");
      throw new AppError("UNAUTHENTICATED");
    }
    request.user = user;
    return true;
  }
}

/** The signed-in user, as set by AuthGuard. Services authorize with it. */
export const CurrentActor = createParamDecorator((_data: unknown, context: ExecutionContext): CurrentUser => {
  const user = context.switchToHttp().getRequest<AuthenticatedRequest>().user;
  if (!user) throw new AppError("UNAUTHENTICATED");
  return user;
});
