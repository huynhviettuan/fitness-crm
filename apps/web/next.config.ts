import type { NextConfig } from "next";

// Sent on every response, pages and API alike (OWASP A02). The Content Security
// Policy needs a per-request nonce, so it is set in src/proxy.ts instead.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=()" },
  ...(process.env.NODE_ENV === "production"
    ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" }]
    : []),
];

const nextConfig: NextConfig = {
  // Do not advertise the framework (OWASP A02).
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Default in Next.js 16.4 and mandatory from the next major version. Signed-in
  // pages opt out of the static shell with `export const instant = false`.
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
    resolveAlias: {
      // What `next-intl/plugin` would add. The plugin itself is not used because it
      // loads @swc/core's native binary at startup, which refuses to run when its
      // cache folder is writable by other accounts (the default on non-system drives).
      "next-intl/config": "./src/i18n/request.ts",
    },
  },
};

export default nextConfig;
