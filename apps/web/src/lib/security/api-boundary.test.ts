// OWASP A01:2025 and T-043 — the web app holds no business logic and never touches the
// database: data comes only from the API, which authenticates and authorizes every call.
// Every Server Action is a public HTTP endpoint, so each one may only call the API.
import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const SRC_DIR = path.join(import.meta.dirname, "..", "..");
const APP_DIR = path.join(SRC_DIR, "app");

function sourceFiles(dir: string): string[] {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return sourceFiles(full);
    return /\.tsx?$/.test(entry.name) ? [full] : [];
  });
}

function imports(source: string): string[] {
  return [...source.matchAll(/^\s*import\s+(?:type\s+)?[^"']*?["']([^"']+)["']/gm)].map((match) => match[1]);
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

describe("the web app reaches data only through the API (T-043)", () => {
  // better-auth/react (sign-in, sign-out) and better-auth/cookies (the cookie's name, for
  // the optimistic redirect in proxy.ts) hold no secrets and touch no data.
  const SERVER_SIDE = /^(@prisma\/|pg$|better-auth(?!\/(react|cookies)$)|@\/generated\/)/;

  for (const file of sourceFiles(SRC_DIR)) {
    const relative = path.relative(SRC_DIR, file);
    it(`${relative} imports no database or server-side auth code`, () => {
      expect(imports(fs.readFileSync(file, "utf8")).filter((name) => SERVER_SIDE.test(name))).toEqual([]);
    });
  }
});

describe("Server Actions", () => {
  const files = sourceFiles(APP_DIR).filter((file) => /^\s*["']use server["']/.test(fs.readFileSync(file, "utf8")));
  const ALLOWED = /^(@\/lib\/api\/|@\/lib\/actions\/result$|@gymcrm\/shared\/)/;

  it("are found", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  for (const file of files) {
    const relative = path.relative(APP_DIR, file);
    const source = fs.readFileSync(file, "utf8");

    it(`${relative} exports only async functions`, () => {
      expect(source).not.toMatch(/export\s+(const|let|var|default)\b/);
    });

    it(`${relative} calls nothing but the API`, () => {
      expect(imports(source).filter((name) => !ALLOWED.test(name))).toEqual([]);
    });

    for (const { name, body } of exportedFunctions(source)) {
      it(`${relative} › ${name} reports errors through runAction()`, () => {
        expect(body).toContain("runAction(");
      });
    }
  }
});
