import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { fetchMercadoPago, MercadoPagoApiError } from "./client.js";

// Mock the retry module to avoid actual delays in tests
vi.mock("../../../src/infra/retry.js", () => ({
  retryAsync: async <T>(fn: () => Promise<T>) => fn(),
}));

describe("MercadoPagoApiError", () => {
  it("creates error with all fields", () => {
    const error = new MercadoPagoApiError("Test error", 401, 30, "Custom hint");
    expect(error.message).toBe("Test error");
    expect(error.status).toBe(401);
    expect(error.retryAfter).toBe(30);
    expect(error.recoveryHint).toBe("Custom hint");
    expect(error.name).toBe("MercadoPagoApiError");
  });

  describe("toAgentError", () => {
    it("returns structured error for 401", () => {
      const error = new MercadoPagoApiError("Unauthorized", 401);
      const agentError = error.toAgentError();
      expect(agentError).toEqual({
        error: "Unauthorized",
        status: 401,
        recoverable: false,
        hint: "Token may be expired. Check configuration.",
      });
    });

    it("returns structured error for 429", () => {
      const error = new MercadoPagoApiError("Rate limited", 429, 60);
      const agentError = error.toAgentError();
      expect(agentError).toEqual({
        error: "Rate limited",
        status: 429,
        recoverable: true,
        hint: "Rate limited. Wait and retry.",
      });
    });

    it("returns structured error for 500", () => {
      const error = new MercadoPagoApiError("Server error", 500);
      const agentError = error.toAgentError();
      expect(agentError).toEqual({
        error: "Server error",
        status: 500,
        recoverable: true,
        hint: "MercadoPago service issue. Retry shortly.",
      });
    });

    it("uses custom hint when provided", () => {
      const error = new MercadoPagoApiError("Error", 400, undefined, "Custom hint");
      const agentError = error.toAgentError();
      expect(agentError.hint).toBe("Custom hint");
    });

    it("uses default hint for other errors", () => {
      const error = new MercadoPagoApiError("Bad request", 400);
      const agentError = error.toAgentError();
      expect(agentError.hint).toBe("Check the request parameters.");
    });
  });
});

describe("fetchMercadoPago", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    vi.resetAllMocks();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  it("makes request with correct headers", async () => {
    const mockResponse = { data: "test" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const schema = z.object({ data: z.string() });
    await fetchMercadoPago("/test", "test-token", schema);

    expect(fetch).toHaveBeenCalledWith("https://api.mercadopago.com/test", {
      method: "GET",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: undefined,
    });
  });

  it("makes POST request with body", async () => {
    const mockResponse = { data: "test" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const schema = z.object({ data: z.string() });
    await fetchMercadoPago("/test", "test-token", schema, {
      method: "POST",
      body: { foo: "bar" },
    });

    expect(fetch).toHaveBeenCalledWith("https://api.mercadopago.com/test", {
      method: "POST",
      headers: {
        Authorization: "Bearer test-token",
        "Content-Type": "application/json",
      },
      body: '{"foo":"bar"}',
    });
  });

  it("parses response with schema", async () => {
    const mockResponse = { value: 42 };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const schema = z.object({ value: z.number() });
    const result = await fetchMercadoPago("/test", "test-token", schema);

    expect(result).toEqual({ value: 42 });
  });

  it("throws MercadoPagoApiError on non-ok response", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401,
      headers: new Headers(),
    } as Response);

    const schema = z.object({ data: z.string() });

    await expect(fetchMercadoPago("/test", "test-token", schema)).rejects.toThrow(
      MercadoPagoApiError,
    );
  });

  it("extracts Retry-After header on 429", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 429,
      headers: new Headers({ "Retry-After": "30" }),
    } as Response);

    const schema = z.object({ data: z.string() });

    try {
      await fetchMercadoPago("/test", "test-token", schema);
    } catch (error) {
      expect(error).toBeInstanceOf(MercadoPagoApiError);
      expect((error as MercadoPagoApiError).retryAfter).toBe(30);
    }
  });

  it("throws on invalid schema", async () => {
    const mockResponse = { wrong: "field" };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response);

    const schema = z.object({ data: z.string() });

    await expect(fetchMercadoPago("/test", "test-token", schema)).rejects.toThrow(
      "Invalid API response",
    );
  });
});
