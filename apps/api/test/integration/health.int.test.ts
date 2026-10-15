import { describe, expect, it } from "vitest";
import { checkHealth } from "../../src/platform/health/health.service.js";

// M9.4 (A-311): the health check reads the database and nothing of the gym.
describe("the health check", () => {
  it("is ok when the database answers", async () => {
    const health = await checkHealth();
    expect(health).toMatchObject({ status: "ok", database: "ok" });
    expect(Math.abs(health.time.getTime() - Date.now())).toBeLessThan(5_000);
  });

  it("is unavailable when the database refuses", async () => {
    const health = await checkHealth(() => Promise.reject(new Error("connection refused")));
    expect(health).toMatchObject({ status: "unavailable", database: "unavailable" });
  });

  it("gives up on a database that does not answer, after a short wait", async () => {
    const started = Date.now();
    const health = await checkHealth(() => new Promise(() => undefined));
    expect(health.status).toBe("unavailable");
    expect(Date.now() - started).toBeLessThan(4_500);
  });
});
