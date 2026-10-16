import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { healthSchema, livenessSchema } from "@gymcrm/shared/health";
import { PublicEndpoint } from "../auth/auth.guard.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { checkHealth, checkLiveness } from "./health.service.js";

/**
 * The health checks (M9.4, A-311, A-315), without a session:
 * - `GET /health` (liveness): the process answers. The hosting platform's health check: a slow or unreachable database must
 *   not make the platform restart a working API, which would only add load.
 * - `GET /health/ready` (readiness): `200` when the API reaches its database, `503` when it does not. The uptime monitor
 *   alerts on it, and the E2E run waits for it.
 */
@ApiTags("health")
@ApiErrors()
@Controller("health")
export class HealthController {
  @Get()
  @PublicEndpoint()
  @ApiResult(livenessSchema)
  liveness(@Res({ passthrough: true }) response: Response) {
    response.setHeader("Cache-Control", "no-store");
    return encode(livenessSchema, checkLiveness());
  }

  @Get("ready")
  @PublicEndpoint()
  @ApiResult(healthSchema)
  @ApiResult(healthSchema, 503, "The database cannot be reached")
  async readiness(@Res({ passthrough: true }) response: Response) {
    const health = await checkHealth();
    response.status(health.status === "ok" ? 200 : 503).setHeader("Cache-Control", "no-store");
    return encode(healthSchema, health);
  }
}
