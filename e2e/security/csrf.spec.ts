// OWASP A08:2025 Software or Data Integrity Failures — cross-site request forgery on /api/v1.
// Server Actions and Better Auth check the request origin themselves; these tests cover
// our own Route Handlers.
import { expect, test } from "../fixtures";

const EVIL_ORIGIN = "https://evil.example";

test.describe("A08 state-changing API requests must come from the app itself", () => {
  test("a same-origin JSON request is accepted (control)", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", { data: { fullName: `CSRF ok ${testTag}`, phone: "0909100100" } });

    expect(response.status()).toBe(201);
  });

  test("a request from another origin is rejected and changes nothing", async ({ apiAs, testTag }) => {
    const attacker = await apiAs("RECEPTIONIST", { origin: EVIL_ORIGIN });
    const response = await attacker.post("/api/v1/customers", { data: { fullName: `CSRF evil ${testTag}`, phone: "0909100200" } });

    expect(response.status()).toBe(403);
    const reception = await apiAs("RECEPTIONIST");
    expect((await (await reception.get(`/api/v1/customers?search=${testTag}`)).json()).total).toBe(0);
  });

  test("a request with no Origin header is rejected", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST", { origin: null });
    const response = await api.post("/api/v1/customers", { data: { fullName: `CSRF none ${testTag}`, phone: "0909100300" } });

    expect(response.status()).toBe(403);
  });

  test("a PATCH from another origin is rejected", async ({ apiAs, testTag }) => {
    const reception = await apiAs("RECEPTIONIST");
    const customer = await (
      await reception.post("/api/v1/customers", { data: { fullName: `CSRF patch ${testTag}`, phone: "0909100400" } })
    ).json();

    const attacker = await apiAs("RECEPTIONIST", { origin: EVIL_ORIGIN });
    const response = await attacker.patch(`/api/v1/customers/${customer.id}`, { data: { fullName: "Hijacked" } });

    expect(response.status()).toBe(403);
  });

  test("a body that is not JSON is refused (form posts cannot smuggle JSON)", async ({ apiAs, testTag }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", {
      headers: { "content-type": "text/plain" },
      data: JSON.stringify({ fullName: `CSRF text ${testTag}`, phone: "0909100500" }),
    });

    expect(response.status()).toBe(415);
    expect(await response.json()).toMatchObject({ code: "UNSUPPORTED_MEDIA_TYPE" });
  });

  test("other sites cannot read API responses (no permissive CORS)", async ({ apiAs }) => {
    const attacker = await apiAs("RECEPTIONIST", { origin: EVIL_ORIGIN });
    const response = await attacker.get("/api/v1/auth/me");

    expect(response.headers()["access-control-allow-origin"]).toBeUndefined();
  });
});
