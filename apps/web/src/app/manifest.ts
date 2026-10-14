import type { MetadataRoute } from "next";

/**
 * What lets the CRM be added to the home screen of a phone (M6.4, D-053, D-056): on an iPhone, push notifications work
 * only for an app added this way (iOS 16.4 and later). The icons are plain until the owner supplies the logo.
 */
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Flow Fitness CRM",
    short_name: "Flow CRM",
    start_url: "/dashboard",
    scope: "/",
    display: "standalone",
    background_color: "#ffffff",
    theme_color: "#0f172a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
    ],
  };
}
