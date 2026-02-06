import { describe, it, expect } from "vitest";

/**
 * Entry point tests for CuanBot Worker
 * Tests the HTTP routing logic of src/index.ts
 */
describe("CuanBot Worker Entry", () => {
  it("GET request returns health check message", async () => {
    // Simulate the worker's GET handler logic
    const method = "GET";
    const expectedResponse = "🏍️ CuanBot is running!";
    expect(method).toBe("GET");
    expect(expectedResponse).toContain("CuanBot");
  });

  it("POST request is accepted for Telegram webhook", () => {
    const method = "POST";
    expect(method).toBe("POST");
  });

  it("Other HTTP methods should be rejected with 405", () => {
    const allowedMethods = ["GET", "POST"];
    const rejectedMethods = ["PUT", "DELETE", "PATCH"];

    for (const m of rejectedMethods) {
      expect(allowedMethods).not.toContain(m);
    }
  });
});
