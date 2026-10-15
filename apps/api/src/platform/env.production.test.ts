import { describe, expect, it } from "vitest";
import { productionIssues, releaseOf } from "./env.production.js";

const deployed = {
  NODE_ENV: "production",
  BETTER_AUTH_URL: "https://app.flowfitness.vn",
  FILE_STORAGE: "r2",
  DATABASE_URL: "postgresql://flow:secret@db.internal:5432/flow",
  FIELD_ENCRYPTION_KEY: "ZmllbGQta2V5LWZpZWxkLWtleS1maWVsZC1rZXktMzI=",
  BACKUP_ENCRYPTION_KEY: "YmFja3VwLWtleS1iYWNrdXAta2V5LWJhY2t1cC0zMmI=",
};

describe("the production settings (M9.4, A-311)", () => {
  it("accepts a deployed configuration", () => {
    expect(productionIssues(deployed)).toEqual([]);
  });

  it("names each setting that would lose data or break sign-in", () => {
    const issues = productionIssues({
      ...deployed,
      BACKUP_ENCRYPTION_KEY: undefined,
      BETTER_AUTH_URL: "http://app.flowfitness.vn",
      FILE_STORAGE: "local",
      DATABASE_URL: "postgresql://flow:secret@localhost:5432/flow",
    });
    expect(issues.map((issue) => issue.key)).toEqual([
      "BETTER_AUTH_URL",
      "FILE_STORAGE",
      "DATABASE_URL",
      "BACKUP_ENCRYPTION_KEY",
    ]);
    expect(JSON.stringify(issues)).not.toContain("secret");
  });

  it("finds a local database written as an address too", () => {
    for (const host of ["127.0.0.1", "[::1]"]) {
      expect(productionIssues({ ...deployed, DATABASE_URL: `postgresql://u:p@${host}/flow` })).toHaveLength(1);
    }
  });

  it("leaves development and tests alone", () => {
    for (const NODE_ENV of ["development", "test"]) {
      expect(
        productionIssues({
          NODE_ENV,
          BETTER_AUTH_URL: "http://localhost:3000",
          FILE_STORAGE: "local",
          DATABASE_URL: "postgresql://u:p@localhost/x",
          FIELD_ENCRYPTION_KEY: deployed.FIELD_ENCRYPTION_KEY,
        }),
      ).toEqual([]);
    }
  });
});

describe("the R2 endpoint (A-318)", () => {
  it("is refused in production, where files and backups go to R2 itself", () => {
    const issues = productionIssues({ ...deployed, R2_ENDPOINT: "http://minio.internal:9000" });
    expect(issues.map((issue) => issue.key)).toEqual(["R2_ENDPOINT"]);
    expect(productionIssues({ ...deployed, NODE_ENV: "development", R2_ENDPOINT: "http://localhost:9000" })).toEqual(
      [],
    );
  });
});

describe("the backup key (A-312)", () => {
  it("is never the field key, in any environment", () => {
    for (const NODE_ENV of ["development", "production"]) {
      const issues = productionIssues({ ...deployed, NODE_ENV, BACKUP_ENCRYPTION_KEY: deployed.FIELD_ENCRYPTION_KEY });
      expect(issues.map((issue) => issue.key)).toEqual(["BACKUP_ENCRYPTION_KEY"]);
    }
  });
});

describe("the release shown by the health check", () => {
  it("prefers RELEASE, then the platform's commit", () => {
    expect(releaseOf({ RELEASE: "v1.2.0", RAILWAY_GIT_COMMIT_SHA: "abc" })).toBe("v1.2.0");
    expect(releaseOf({ RAILWAY_GIT_COMMIT_SHA: "0123456789abcdef" })).toBe("0123456789abcdef");
    expect(releaseOf({ RENDER_GIT_COMMIT: "fedcba" })).toBe("fedcba");
    expect(releaseOf({})).toBeNull();
  });
});
