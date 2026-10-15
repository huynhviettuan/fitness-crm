import { describe, expect, it } from "vitest";
import { checkHealth, checkLiveness } from "../../src/platform/health/health.service.js";

// M9.4 (A-311, A-315): liveness answers without the database; readiness reads it, and nothing of the gym.
describe("liveness", () => {
  it("answers ok with the release and time, without asking the database", () => {
    const liveness = checkLiveness();
    expect(liveness.status).toBe("ok");
    expect(Object.keys(liveness).sort()).toEqual(["release", "status", "time"]);
  });
});

describe("readiness", () => {
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
