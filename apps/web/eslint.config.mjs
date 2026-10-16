import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import { prettier, readability } from "@gymcrm/config/eslint";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  readability,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    // Generated code
    "src/generated/**",
  ]),
  prettier,
]);

export default eslintConfig;
