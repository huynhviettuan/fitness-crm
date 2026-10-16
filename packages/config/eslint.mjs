// Lint presets. `default` is for the TypeScript packages that are not Next.js apps (api,
// shared, e2e); apps/web uses eslint-config-next plus `readability` and `prettier`.
import js from "@eslint/js";
import prettierConfig from "eslint-config-prettier";
import tseslint from "typescript-eslint";

/** Rules that keep code easy to read; all fixable with `eslint --fix`. */
export const readability = {
  rules: {
    // Type-only imports say so, and vanish from the built JavaScript.
    "@typescript-eslint/consistent-type-imports": ["error", { fixStyle: "inline-type-imports" }],
    eqeqeq: ["error", "smart"],
    // A body on its own line gets braces; a one-line `if (x) return y;` may stay.
    curly: ["error", "multi-line"],
    "object-shorthand": "error",
    "prefer-template": "error",
    "no-useless-rename": "error",
  },
};

/** Turns off every rule that would argue with Prettier about formatting. Goes last. */
export const prettier = prettierConfig;

export default [js.configs.recommended, ...tseslint.configs.recommended, readability, prettier];
