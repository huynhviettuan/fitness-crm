import { Controller, Get, Res } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import type { Response } from "express";
import { healthSchema } from "@flow/shared/health";
import { PublicEndpoint } from "../auth/auth.guard.js";
import { encode } from "../http/encode.js";
import { ApiErrors, ApiResult } from "../http/openapi.js";
import { checkHealth } from "./health.service.js";

/**
 * The health check (M9.4, A-311): what the hosting platform and the uptime monitor call, without a session. `200` when the
 * API reaches its database, `503` when it does not, so the platform keeps the previous release and the monitor alerts.
 */
@ApiTags("health")
@ApiErrors()
@Controller("health")
export class HealthController {
  @Get()
  @PublicEndpoint()
  @ApiResult(healthSchema)
  @ApiResult(healthSchema, 503, "The database cannot be reached")
  async health(@Res({ passthrough: true }) response: Response) {
    const health = await checkHealth();
    response.status(health.status === "ok" ? 200 : 503).setHeader("Cache-Control", "no-store");
    return encode(healthSchema, health);
  }
}
