import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

const PUBLIC_PATHS = new Set(["/login"]);

/**
 * Runs before every page request:
 * 1. Sends visitors without a session cookie to the login page. This is an
 *    optimistic check only; real authentication runs on the server for every request.
 * 2. Sets a Content Security Policy with a fresh nonce (OWASP A02/A05). Next.js reads
 *    the nonce from the request header and applies it to its own scripts.
 */
export function proxy(request: NextRequest) {
  if (!PUBLIC_PATHS.has(request.nextUrl.pathname) && !getSessionCookie(request)) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const policy = contentSecurityPolicy(nonce, request.nextUrl.protocol === "https:");

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", policy);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

function contentSecurityPolicy(nonce: string, https: boolean): string {
  const isDev = process.env.NODE_ENV === "development";
  return [
    "default-src 'self'",
    // React needs eval only for development error overlays.
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    // Radix positions popovers with inline style attributes and Sonner injects a
    // <style> tag at runtime; inline styles cannot run code, scripts stay strict.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' blob: data:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(https ? ["upgrade-insecure-requests"] : []),
  ].join("; ");
}

export const config = {
  matcher: [
    {
      source: "/((?!api|_next/static|_next/image|favicon.ico).*)",
      // Prefetches render no HTML, so they need neither a nonce nor a redirect.
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
