// M9.4 (A-311): settings that work on a developer's machine but lose data or break sign-in once deployed. With
// NODE_ENV=production the API and the worker refuse to start on them, naming the setting, instead of failing later.

export type ProductionSettings = {
  NODE_ENV: string;
  BETTER_AUTH_URL: string;
  FILE_STORAGE: string;
  DATABASE_URL: string;
  FIELD_ENCRYPTION_KEY: string;
  BACKUP_ENCRYPTION_KEY?: string | undefined;
  R2_ENDPOINT?: string | undefined;
};

export type SettingIssue = { key: keyof ProductionSettings; message: string };

export function productionIssues(settings: ProductionSettings): SettingIssue[] {
  const issues: SettingIssue[] = [];
  // A backup sealed with the field key would put the key's two secrets in one place (A-312), in every environment.
  if (settings.BACKUP_ENCRYPTION_KEY && settings.BACKUP_ENCRYPTION_KEY === settings.FIELD_ENCRYPTION_KEY) {
    issues.push({
      key: "BACKUP_ENCRYPTION_KEY",
      message: "BACKUP_ENCRYPTION_KEY must differ from FIELD_ENCRYPTION_KEY",
    });
  }
  if (settings.NODE_ENV !== "production") return issues;
  // The session cookie is Secure and browsers keep it only over HTTPS; the Origin check compares with this URL (T-033).
  if (!/^https:\/\//i.test(settings.BETTER_AUTH_URL)) {
    issues.push({ key: "BETTER_AUTH_URL", message: "BETTER_AUTH_URL must be an https:// URL in production" });
  }
  // A platform's disk is replaced at every deployment: pictures and documents kept on it would be lost (T-052).
  if (settings.FILE_STORAGE !== "r2") {
    issues.push({
      key: "FILE_STORAGE",
      message: "FILE_STORAGE must be r2 in production: the local disk is lost at each deployment",
    });
  }
  // A database on the same machine is a developer's; the deployed API reaches its managed database by name.
  if (/@(localhost|127\.0\.0\.1|\[::1\])(:|\/)/i.test(settings.DATABASE_URL)) {
    issues.push({
      key: "DATABASE_URL",
      message: "DATABASE_URL points at this machine; production uses the managed database",
    });
  }
  // A stand-in S3 server is for tests only (A-318): production files and backups go to R2 itself.
  if (settings.R2_ENDPOINT) {
    issues.push({
      key: "R2_ENDPOINT",
      message: "R2_ENDPOINT is for tests only; production uses the R2 account's host",
    });
  }
  // The worker's daily dump is the copy that does not depend on the database host (doc 15).
  if (!settings.BACKUP_ENCRYPTION_KEY) {
    issues.push({
      key: "BACKUP_ENCRYPTION_KEY",
      message: "BACKUP_ENCRYPTION_KEY is required in production: the daily backup is sealed with it",
    });
  }
  return issues;
}

/** The release running (shown by the health check): RELEASE if set, else the commit the platform deployed, shortened. */
export function releaseOf(variables: Record<string, string | undefined>): string | null {
  const value = variables.RELEASE || variables.RAILWAY_GIT_COMMIT_SHA || variables.RENDER_GIT_COMMIT;
  return value ? value.trim().slice(0, 40) : null;
}
