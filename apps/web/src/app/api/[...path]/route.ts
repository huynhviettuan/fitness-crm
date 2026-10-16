import { env } from "@/lib/env";

// Browsers reach the API through this app (T-053): sign-in and sign-out, customer search,
// and any direct /api/* call. One origin keeps the session cookie first-party, the CSP's
// connect-src 'self', and the API's Origin check simple; the API still authenticates and
// authorizes every request. The browser's address goes along in X-Forwarded-For, which
// Next.js sets from the connection or from the platform's own proxy, so sign-in rate
// limits and security logs see the real client.

// Headers that describe one connection and must not be passed on (RFC 9110 §7.6.1).
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-connection",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
  "host",
];

async function forward(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const target = new URL(url.pathname + url.search, env.API_URL);

  const headers = new Headers(request.headers);
  for (const name of [...HOP_BY_HOP, "content-length"]) headers.delete(name);
  // Bodies are small JSON documents (the API accepts at most 200 kB).
  const body = request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();

  const answer = await fetch(target, {
    method: request.method,
    headers,
    body: body && body.byteLength > 0 ? body : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers(answer.headers);
  // fetch has already decoded the body.
  for (const name of [...HOP_BY_HOP, "content-length", "content-encoding"]) responseHeaders.delete(name);
  return new Response(answer.body, { status: answer.status, statusText: answer.statusText, headers: responseHeaders });
}

export {
  forward as DELETE,
  forward as GET,
  forward as HEAD,
  forward as OPTIONS,
  forward as PATCH,
  forward as POST,
  forward as PUT,
};
