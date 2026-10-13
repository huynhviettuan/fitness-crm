// OWASP A07:2025 Authentication Failures — password guessing is throttled.
// Runs in its own Playwright project after every other test: once the limit is hit,
// sign-in from this machine is blocked for a minute. The E2E global setup clears the
// rate-limit table, so the next run starts fresh.
import { expect, test } from "../fixtures";

test("@smoke repeated failed sign-ins from one IP are throttled with 429", async ({ apiAs }) => {
  const api = await apiAs(null);
  const statuses: number[] = [];

  for (let attempt = 0; attempt < 25 && !statuses.includes(429); attempt++) {
    const response = await api.post("/api/auth/sign-in/email", {
      data: { email: "nobody@fitness-crm.test", password: `guess-${attempt}-wrong` },
    });
    statuses.push(response.status());
  }

  expect(statuses).toContain(429);
  // The limit is 20 per minute (T-028); earlier sign-ins in this run count too.
  expect(statuses.indexOf(429)).toBeLessThanOrEqual(20);
  expect(statuses.filter((s) => s !== 401 && s !== 429)).toEqual([]);
});
