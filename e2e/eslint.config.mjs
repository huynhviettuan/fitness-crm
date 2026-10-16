import { defineConfig, globalIgnores } from "eslint/config";
import base from "@gymcrm/config/eslint";

export default defineConfig([
  ...base,
  {
    // Playwright reads a fixture's dependencies from its destructured first argument,
    // so a fixture without dependencies must be written `async ({}, use) => ...`.
    rules: { "no-empty-pattern": "off" },
  },
  globalIgnores(["test-results/**", "playwright-report/**", ".auth/**"]),
]);
