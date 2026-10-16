import { defineConfig } from "@playwright/test";
import base from "./playwright.config";

// What the pull-request CI runs: the smoke cases of the main features (tests tagged @smoke) and the OWASP security
// suite (the "A01" to "A10" describes of e2e/security, API-only and fast). The whole suite runs nightly (full-e2e.yml).
export default defineConfig({ ...base, grep: /@smoke|sign in as |A(0[1-9]|10)[ /]/ });
