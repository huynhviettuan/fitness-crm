// Lint preset for the TypeScript packages that are not Next.js apps (api, shared, e2e).
// apps/web uses eslint-config-next instead.
import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default [js.configs.recommended, ...tseslint.configs.recommended];
