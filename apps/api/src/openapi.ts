// Writes the OpenAPI document to apps/api/openapi.json, the contract the web app's
// client is generated from (docs/07). Run after a build: pnpm --filter api openapi
// With --check, fails instead when the committed file is out of date (CI).
import "dotenv/config";
import { readFileSync, writeFileSync } from "node:fs";
import { createApp, openApiDocument } from "./app.js";

const FILE = new URL("../openapi.json", import.meta.url);

const app = await createApp({ logger: false });
const document = `${JSON.stringify(openApiDocument(app), null, 2)}\n`;
await app.close();

if (process.argv.includes("--check")) {
  let committed = "";
  try {
    committed = readFileSync(FILE, "utf8");
  } catch {
    // Missing counts as out of date.
  }
  if (committed !== document) {
    console.error("apps/api/openapi.json is out of date. Run: pnpm --filter api openapi");
    process.exit(1);
  }
  console.info("apps/api/openapi.json is up to date.");
} else {
  writeFileSync(FILE, document);
  console.info("Wrote apps/api/openapi.json");
}
