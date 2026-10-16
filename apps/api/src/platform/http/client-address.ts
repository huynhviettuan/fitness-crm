import type { NextFunction, Request, Response } from "express";

/**
 * Sign-in rate limits and security logs key on X-Forwarded-For (T-053). Requests from
 * the web app carry the browser's address there; a client that calls the API directly
 * (future member app, devices) gets its connection's address instead, so it never falls
 * into a bucket shared with everyone.
 */
export function clientAddress(request: Request, _response: Response, next: NextFunction): void {
  if (!request.headers["x-forwarded-for"] && request.socket.remoteAddress) {
    request.headers["x-forwarded-for"] = request.socket.remoteAddress;
  }
  next();
}
