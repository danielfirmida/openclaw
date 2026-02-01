import { z } from "zod";

import { retryAsync } from "../../../src/infra/retry.js";

const MERCADOPAGO_API_BASE = "https://api.mercadopago.com";
const RETRY_DEFAULTS = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

export class MercadoPagoApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
    public readonly recoveryHint?: string,
  ) {
    super(message);
    this.name = "MercadoPagoApiError";
  }

  // Agent-native: structured error for AI recovery
  toAgentError() {
    return {
      error: this.message,
      status: this.status,
      recoverable: this.status === 429 || this.status >= 500,
      hint: this.recoveryHint ?? this.getDefaultHint(),
    };
  }

  private getDefaultHint(): string {
    if (this.status === 401) return "Token may be expired. Check configuration.";
    if (this.status === 429) return "Rate limited. Wait and retry.";
    if (this.status >= 500) return "MercadoPago service issue. Retry shortly.";
    return "Check the request parameters.";
  }
}

export async function fetchMercadoPago<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  return retryAsync(
    async () => {
      const res = await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
        method: options?.method ?? "GET",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: options?.body ? JSON.stringify(options.body) : undefined,
      });

      if (!res.ok) {
        const retryAfter =
          res.status === 429 ? Number(res.headers.get("Retry-After")) || undefined : undefined;
        throw new MercadoPagoApiError(
          `MercadoPago API ${path} failed (${res.status})`,
          res.status,
          retryAfter,
        );
      }

      // Type-safe parsing with Zod
      const json = await res.json();
      const parsed = schema.safeParse(json);
      if (!parsed.success) {
        throw new MercadoPagoApiError(
          `Invalid API response: ${parsed.error.message}`,
          500,
          undefined,
          "API response format changed. Contact support.",
        );
      }
      return parsed.data;
    },
    {
      ...RETRY_DEFAULTS,
      shouldRetry: (err) =>
        err instanceof MercadoPagoApiError && (err.status === 429 || err.status >= 500),
      retryAfterMs: (err) =>
        err instanceof MercadoPagoApiError && err.retryAfter ? err.retryAfter * 1000 : undefined,
    },
  );
}

// Fetch raw text (for CSV reports)
export async function fetchMercadoPagoRaw(path: string, token: string): Promise<string> {
  const res = await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new MercadoPagoApiError(
        "Report not ready yet",
        404,
        undefined,
        "Report is still processing. Wait 30 seconds and retry.",
      );
    }
    throw new MercadoPagoApiError(`Failed to download report (${res.status})`, res.status);
  }

  return res.text();
}
