// OWASP A01:2025 — every Server Action is a public HTTP endpoint, so each one must
// authenticate before doing anything. This guard fails when a new action forgets to.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const APP_DIR = path.join(import.meta.dirname, "..", "..", "app");

function serverActionFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return serverActionFiles(full);
    if (!/\.tsx?$/.test(entry.name)) return [];
    const source = fs.readFileSync(full, "utf8");
    return /^\s*["']use server["']/.test(source) ? [full] : [];
  });
}

/** Each exported function's source, from its declaration up to the next one. */
function exportedFunctions(source: string): { name: string; body: string }[] {
  const pattern = /export\s+async\s+function\s+(\w+)/g;
  const matches = [...source.matchAll(pattern)];
  return matches.map((match, i) => ({
    name: match[1],
    body: source.slice(match.index, matches[i + 1]?.index ?? source.length),
  }));
}

describe("Server Actions", () => {
  const files = serverActionFiles(APP_DIR);

  it("are found", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = path.relative(APP_DIR, file);
    const source = fs.readFileSync(file, "utf8");

    it(`${relative} exports only async functions`, () => {
      expect(source).not.toMatch(/export\s+(const|let|var|default)\b/);
    });

    for (const { name, body } of exportedFunctions(source)) {
      it(`${relative} › ${name} authenticates with requireActionUser()`, () => {
        expect(body).toContain("requireActionUser()");
      });
    }
  }
});
