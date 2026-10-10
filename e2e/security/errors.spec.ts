// OWASP A10:2025 Mishandling of Exceptional Conditions — bad input fails closed with
// the documented error shape and never leaks internals.
import { expect, test } from "../fixtures";

const LEAKS = /\bat\s+\S+\s+\(|node_modules|prisma|stack|Error:|SELECT |INSERT /i;

async function expectDocumentedError(response: { status(): number; text(): Promise<string> }, status: number, code: string) {
  expect(response.status()).toBe(status);
  const text = await response.text();
  expect(text).not.toMatch(LEAKS);
  const body = JSON.parse(text);
  expect(Object.keys(body).sort()).toEqual(["code", "details", "message"]);
  expect(body.code).toBe(code);
}

test.describe("A10 exceptional input", () => {
  test("malformed JSON", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", {
      headers: { "content-type": "application/json" },
      data: '{"fullName": "broken',
    });
    await expectDocumentedError(response, 400, "VALIDATION_FAILED");
  });

  test("wrong types", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", { data: { fullName: 123, phone: true, notes: ["x"] } });
    await expectDocumentedError(response, 400, "VALIDATION_FAILED");
  });

  test("a JSON body that is not an object", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", { data: [1, 2, 3] });
    await expectDocumentedError(response, 400, "VALIDATION_FAILED");
  });

  test("an oversized field", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.post("/api/v1/customers", { data: { fullName: "A".repeat(50_000), phone: "0909300100" } });
    await expectDocumentedError(response, 400, "VALIDATION_FAILED");
  });

  test("control characters such as NUL, which PostgreSQL cannot store", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    for (const fullName of ["Nul\u0000byte", "Bell\u0007char"]) {
      const response = await api.post("/api/v1/customers", { data: { fullName, phone: "0909300200" } });
      await expectDocumentedError(response, 400, "VALIDATION_FAILED");
    }
  });

  test("an id that is not a UUID, and one that does not exist", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    await expectDocumentedError(await api.get("/api/v1/customers/1 OR 1=1"), 404, "NOT_FOUND");
    await expectDocumentedError(await api.get("/api/v1/customers/00000000-0000-4000-8000-000000000000"), 404, "NOT_FOUND");
  });

  test("an unsupported HTTP method", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    const response = await api.fetch("/api/v1/customers", { method: "DELETE" });
    expect(response.status()).toBe(405);
  });

  test("absurd paging values", async ({ apiAs }) => {
    const api = await apiAs("RECEPTIONIST");
    await expectDocumentedError(await api.get("/api/v1/customers?pageSize=100000"), 400, "VALIDATION_FAILED");
    await expectDocumentedError(await api.get("/api/v1/customers?page=-1"), 400, "VALIDATION_FAILED");
  });
});
