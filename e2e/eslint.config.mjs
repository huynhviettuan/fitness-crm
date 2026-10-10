import js from "@eslint/js";
import { defineConfig, globalIgnores } from "eslint/config";
import tseslint from "typescript-eslint";

export default defineConfig([
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // Playwright reads a fixture's dependencies from its destructured first argument,
    // so a fixture without dependencies must be written `async ({}, use) => ...`.
    rules: { "no-empty-pattern": "off" },
  },
  globalIgnores(["test-results/**", "playwright-report/**", ".auth/**"]),
]);
