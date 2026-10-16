// Code style for the whole repository (`pnpm format`, checked in CI with `pnpm format:check`).
// Lines wrap at 120 characters so two files fit side by side; ESLint leaves formatting to
// Prettier (eslint-config-prettier in packages/config).

/** @type {import("prettier").Config} */
export default {
  printWidth: 120,
  semi: true,
  singleQuote: false,
  trailingComma: "all",
  // Tailwind classes in their canonical order, so class lists read the same everywhere.
  plugins: ["prettier-plugin-tailwindcss"],
  tailwindStylesheet: "./apps/web/src/app/globals.css",
  tailwindFunctions: ["cn", "cva"],
};
