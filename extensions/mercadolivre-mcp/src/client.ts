import { z } from "zod";
import crypto from "node:crypto";

import { retryAsync } from "../../../src/infra/retry.js";
import type { MercadoLivreConfig, TokenState } from "./types.js";
import { TokenResponseSchema } from "./types.js";

const MERCADOLIVRE_API_BASE = "https://api.mercadolibre.com";
const MERCADOLIVRE_AUTH_URL = "https://auth.mercadolibre.com/authorization";
const MERCADOLIVRE_TOKEN_URL = "https://api.mercadolibre.com/oauth/token";

// Token refresh buffer (refresh 5 minutes before expiry)
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

const RETRY_DEFAULTS = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.1,
};

/**
 * Agent-native API error with recovery hints
 */
export class MercadoLivreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
    public readonly recoveryHint?: string,
  ) {
    super(message);
    this.name = "MercadoLivreApiError";
  }

  /** Structured error for AI agent recovery */
  toAgentError() {
    return {
      error: this.message,
      status: this.status,
      recoverable: this.status === 429 || this.status >= 500,
      hint: this.recoveryHint ?? this.getDefaultHint(),
      isReadOnly: true,
    };
  }

  private getDefaultHint(): string {
    if (this.status === 401) return "Token expired. Re-authenticate with Mercado Livre.";
    if (this.status === 403) return "Permission denied. Check OAuth scopes.";
    if (this.status === 429) return "Rate limited. Wait 60 seconds and retry.";
    if (this.status >= 500) return "Mercado Livre service issue. Retry shortly.";
    return "Check request parameters.";
  }
}

/**
 * OAuth2 state for PKCE flow
 */
type OAuthState = {
  state: string;
  codeVerifier: string;
  codeChallenge: string;
};

/**
 * Generate PKCE code verifier and challenge
 */
function generatePKCE(): { codeVerifier: string; codeChallenge: string } {
  // Generate 43-128 character random string for code_verifier
  const codeVerifier = crypto.randomBytes(32).toString("base64url");

  // Generate code_challenge using S256
  const hash = crypto.createHash("sha256").update(codeVerifier).digest();
  const codeChallenge = hash.toString("base64url");

  return { codeVerifier, codeChallenge };
}

/**
 * Create authorization URL with PKCE
 */
export function createAuthorizationUrl(
  config: MercadoLivreConfig,
): { url: string; state: OAuthState } {
  const state = crypto.randomUUID();
  const { codeVerifier, codeChallenge } = generatePKCE();

  const params = new URLSearchParams({
    response_type: "code",
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return {
    url: `${MERCADOLIVRE_AUTH_URL}?${params.toString()}`,
    state: { state, codeVerifier, codeChallenge },
  };
}

/**
 * Exchange authorization code for tokens
 */
export async function exchangeCodeForTokens(
  config: MercadoLivreConfig,
  code: string,
  codeVerifier: string,
): Promise<TokenState> {
  const response = await fetch(MERCADOLIVRE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      code,
      redirect_uri: config.redirectUri,
      code_verifier: codeVerifier,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new MercadoLivreApiError(
      `Token exchange failed: ${error}`,
      response.status,
      undefined,
      "Authorization code may be expired. Restart the OAuth flow.",
    );
  }

  const data = await response.json();
  const parsed = TokenResponseSchema.parse(data);

  return {
    access: parsed.access_token,
    refresh: parsed.refresh_token,
    expires: Date.now() + parsed.expires_in * 1000,
    userId: parsed.user_id,
  };
}

/**
 * Refresh access token using refresh token
 */
async function refreshToken(
  config: MercadoLivreConfig,
  refreshTokenValue: string,
): Promise<TokenState> {
  const response = await fetch(MERCADOLIVRE_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Accept: "application/json",
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: refreshTokenValue,
    }),
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new MercadoLivreApiError(
      "Token refresh failed",
      response.status,
      undefined,
      "Refresh token expired. Re-authenticate with Mercado Livre.",
    );
  }

  const data = await response.json();
  const parsed = TokenResponseSchema.parse(data);

  return {
    access: parsed.access_token,
    refresh: parsed.refresh_token,
    expires: Date.now() + parsed.expires_in * 1000,
    userId: parsed.user_id,
  };
}

/**
 * Token manager with deduplication for concurrent refresh requests
 */
export function createTokenManager(config: MercadoLivreConfig) {
  let tokenState: TokenState | null = null;
  let refreshPromise: Promise<string> | null = null;

  return {
    /**
     * Set initial token state (after OAuth flow)
     */
    setToken(state: TokenState) {
      tokenState = state;
    },

    /**
     * Get current token state (for persistence)
     */
    getTokenState(): TokenState | null {
      return tokenState;
    },

    /**
     * Check if authenticated
     */
    isAuthenticated(): boolean {
      return tokenState !== null;
    },

    /**
     * Get valid access token, refreshing if needed
     * Uses deduplication to prevent concurrent refresh race conditions
     */
    async getToken(): Promise<string> {
      if (!tokenState) {
        throw new MercadoLivreApiError(
          "Not authenticated",
          401,
          undefined,
          "Run OAuth flow to authenticate with Mercado Livre.",
        );
      }

      // Token still valid
      if (Date.now() < tokenState.expires - REFRESH_BUFFER_MS) {
        return tokenState.access;
      }

      // Capture refresh token before async operation to avoid race conditions
      const currentRefreshToken = tokenState.refresh;

      // Deduplicate concurrent refresh requests
      if (!refreshPromise) {
        refreshPromise = (async () => {
          try {
            const newToken = await refreshToken(config, currentRefreshToken);
            tokenState = newToken;
            return newToken.access;
          } finally {
            refreshPromise = null;
          }
        })();
      }

      return refreshPromise;
    },
  };
}

/**
 * Make authenticated GET request to Mercado Livre API
 * This is READ-ONLY - no POST/PUT/DELETE methods allowed
 */
export async function fetchMercadoLivre<T>(
  endpoint: string,
  accessToken: string,
  schema: z.ZodType<T>,
): Promise<T> {
  return retryAsync(
    async () => {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15_000);

      try {
        const response = await fetch(`${MERCADOLIVRE_API_BASE}${endpoint}`, {
          method: "GET", // READ-ONLY: Only GET requests allowed
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Accept: "application/json",
          },
          signal: controller.signal,
        });

        if (!response.ok) {
          const retryAfter =
            response.status === 429
              ? Number(response.headers.get("Retry-After")) || 60
              : undefined;

          throw new MercadoLivreApiError(
            `Mercado Livre API ${endpoint} failed (${response.status})`,
            response.status,
            retryAfter,
          );
        }

        const json = await response.json();
        const parsed = schema.safeParse(json);

        if (!parsed.success) {
          throw new MercadoLivreApiError(
            `Invalid API response: ${parsed.error.message}`,
            500,
            undefined,
            "API response format changed. Contact support.",
          );
        }

        return parsed.data;
      } finally {
        clearTimeout(timeout);
      }
    },
    {
      ...RETRY_DEFAULTS,
      shouldRetry: (err) =>
        err instanceof MercadoLivreApiError && (err.status === 429 || err.status >= 500),
      retryAfterMs: (err) =>
        err instanceof MercadoLivreApiError && err.retryAfter
          ? err.retryAfter * 1000
          : undefined,
    },
  );
}
