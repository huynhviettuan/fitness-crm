import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// Only the OWASP security suite: the "A01" to "A10" describes of e2e/security.
export default defineConfig({ ...base, grep: /sign in as |A(0[1-9]|10)[ /]/ });
