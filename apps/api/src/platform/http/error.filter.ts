import { Catch, HttpException, NotFoundException, PayloadTooLargeException, BadRequestException } from "@nestjs/common";
import type { ArgumentsHost, ExceptionFilter } from "@nestjs/common";
import type { Request, Response } from "express";
import type { ApiErrorBody } from "@flow/shared/errors";
import { AppError, isAppError } from "../errors/app-error.js";

/** Writes an error in the documented format (docs/07 "Error contract"). */
export function sendError(response: Response, error: AppError): void {
  const body: ApiErrorBody = {
    code: error.code,
    message: error.message,
    details: {
      ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {}),
      ...(error.duplicate ? { duplicate: error.duplicate } : {}),
      ...(error.exportLimit ? { exportLimit: error.exportLimit } : {}),
    },
  };
  response.status(error.httpStatus).json(body);
}

/**
 * Every error leaves in the documented format, without internals (OWASP A10).
 * Unexpected errors are logged and reported as INTERNAL_ERROR.
 */
@Catch()
export class ErrorFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<Request>();
    const response = http.getResponse<Response>();

    if (isAppError(exception)) return sendError(response, exception);

    if (exception instanceof NotFoundException) {
      const allowed = allowedMethods(request);
      if (allowed.length > 0) {
        response.status(405).set("Allow", allowed.join(", ")).end();
        return;
      }
      return sendError(response, new AppError("NOT_FOUND"));
    }
    // Malformed or oversized JSON, from the body parser.
    if (exception instanceof BadRequestException || exception instanceof PayloadTooLargeException) {
      return sendError(response, new AppError("VALIDATION_FAILED", { message: "Request body must be JSON" }));
    }
    if (exception instanceof HttpException && exception.getStatus() < 500) {
      return sendError(response, new AppError("VALIDATION_FAILED"));
    }

    console.error("Unhandled API error", exception);
    sendError(response, new AppError("INTERNAL_ERROR"));
  }
}

type RouterLayer = { route?: { methods: Record<string, boolean> }; match(path: string): boolean };

/** Methods the path does support, so an unsupported one gets 405 rather than 404. */
function allowedMethods(request: Request): string[] {
  const stack = (request.app as unknown as { router: { stack: RouterLayer[] } }).router.stack;
  // The full path: inside a handler mounted under a prefix, request.path is relative.
  const path = new URL(request.originalUrl, "http://api.invalid").pathname;
  const methods = new Set<string>();
  for (const layer of stack) {
    if (!layer.route || !layer.match(path)) continue;
    for (const method of Object.keys(layer.route.methods)) methods.add(method.toUpperCase());
  }
  methods.delete("_ALL");
  return [...methods];
}
