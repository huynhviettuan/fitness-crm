import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { DocumentBuilder, SwaggerModule, type OpenAPIObject } from "@nestjs/swagger";
import { toNodeHandler } from "better-auth/node";
import { AppModule } from "./app.module.js";
import { auth } from "./platform/auth/auth.js";
import { AppError } from "./platform/errors/app-error.js";
import { clientAddress } from "./platform/http/client-address.js";
import { sendError } from "./platform/http/error.filter.js";
import { zodToOpenApi } from "./platform/http/openapi.js";
import { securityHeaders } from "./platform/http/security-headers.js";

export const API_PREFIX = "api/v1";

/**
 * The configured application, not yet listening. Used by main.ts and the OpenAPI script.
 * `docs` serves interactive API docs at /api/docs (development and staging only).
 */
export async function createApp(options: { logger?: false; docs?: boolean } = {}): Promise<NestExpressApplication> {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    bodyParser: false,
    ...(options.logger === false ? { logger: false } : { logger: ["error", "warn", "log"] }),
  });
  app.disable("x-powered-by");
  app.use(securityHeaders);
  app.use(clientAddress);
  // Better Auth reads the raw body itself, so it is mounted before the JSON parser (T-044).
  app.getHttpAdapter().getInstance().all("/api/auth/*splat", toNodeHandler(auth));
  app.useBodyParser("json", { limit: "200kb" });
  app.setGlobalPrefix(API_PREFIX);
  app.enableShutdownHooks();
  await app.init();
  if (options.docs) SwaggerModule.setup("api/docs", app, () => openApiDocument(app));
  // Anything else (outside /api/v1 and /api/auth) is not ours: a documented 404.
  app.use((_request: unknown, response: Parameters<typeof sendError>[0]) =>
    sendError(response, new AppError("NOT_FOUND")),
  );
  return app;
}

/** The OpenAPI document: the API contract (docs/07). */
export function openApiDocument(app: NestExpressApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle("Flow Fitness CRM API")
    .setDescription("REST API under /api/v1. Errors use the documented error contract (docs/07).")
    .setVersion("1")
    .addCookieAuth("better-auth.session_token")
    .build();
  return SwaggerModule.createDocument(app, config, { standardSchemaConverter: zodToOpenApi });
}
