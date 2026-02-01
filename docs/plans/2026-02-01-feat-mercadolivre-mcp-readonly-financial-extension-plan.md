---
title: "feat: Mercado Livre Read-Only MCP Extension for Financial Reporting"
type: feat
date: 2026-02-01
deepened: 2026-02-01
---

# Mercado Livre Read-Only MCP Extension for Financial Reporting

## Enhancement Summary

**Deepened on:** 2026-02-01
**Research agents used:** security-sentinel, performance-oracle, code-simplicity-reviewer, agent-native-reviewer, kieran-typescript-reviewer, best-practices-researcher, learnings-researcher (MercadoPago + BTG patterns)

### Key Improvements from Research

1. **Security**: Add PKCE (S256) to OAuth flow, validate state parameter cryptographically, use secure credential storage via OpenClaw API
2. **Performance**: Token refresh deduplication pattern, separate rate limit buckets per endpoint, AbortController for request cancellation
3. **Simplicity**: Consolidate 7 tools to 4 core tools (user-info, orders, items, billing), inline auth logic in client.ts
4. **Agent-Native**: Add workflow hints in tool descriptions, pagination guidance, include `nextAction` suggestions in responses

### Critical Requirements Identified

- **PKCE mandatory**: Use `code_challenge_method=S256` for OAuth security
- **State validation**: Cryptographically random state, stored and validated
- **No hardcoded tokens**: Use environment variables only for credentials
- **Read-only enforcement**: Only `read` and `offline_access` scopes

## Overview

Create a **read-only** OpenClaw plugin extension for Mercado Livre API integration, enabling sellers to access their financial data for accounting purposes (DRE - Demonstração do Resultado do Exercício, Balanço Patrimonial).

**Critical Constraint**: This plugin MUST NOT have any write/push capabilities. The AI cannot modify, create, or delete any data on Mercado Livre.

## Problem Statement / Motivation

Sellers on Mercado Livre need to access their financial data for accounting and tax reporting:
- Monthly billing periods and invoices
- Order history with fees and commissions
- Sales reconciliation data
- Product listing performance

Currently, accessing this data requires manual navigation through the Mercado Livre seller dashboard. An OpenClaw integration would allow AI-assisted financial analysis and report generation.

## Proposed Solution

Create `extensions/mercadolivre-mcp/` following the established patterns from `mercadopago-mcp` and `btg-pactual` extensions:

1. **OAuth2 Authentication** via Authorization Code flow with manual URL paste fallback (VPS compatible)
2. **Read-only tools** for orders, items, billing, and user info
3. **Token refresh handling** with deduplication and atomic persistence
4. **Agent-native error handling** with recovery hints

## Technical Approach

### Architecture (Simplified)

**Research Insight:** Reduced from 9 files to 5 files. Auth logic inlined in client.ts, tools consolidated.

```
extensions/mercadolivre-mcp/
├── index.ts                    # Plugin entry point with register()
├── openclaw.plugin.json        # Plugin manifest with config schema
├── package.json                # Dependencies (zod, typebox)
├── src/
│   ├── client.ts              # API client with auth, retry, token refresh
│   ├── types.ts               # Zod schemas for config & responses
│   └── tools/
│       ├── get-user-info.ts   # Seller account info
│       ├── list-orders.ts     # Orders (list + single by ID)
│       ├── list-items.ts      # Items (list + single by ID)
│       └── get-billing.ts     # Billing periods + details combined
```

### Authentication Strategy

**OAuth2 Authorization Code Flow with PKCE** (Mercado Livre does NOT support device code flow):

1. Plugin generates `code_verifier` (cryptographically random) and `code_challenge` (SHA256 hash)
2. Plugin generates authorization URL with state parameter + code_challenge
3. User opens URL in browser, authorizes app
4. User pastes redirect URL back to CLI (VPS compatible)
5. Plugin validates state parameter matches stored value
6. Plugin exchanges code + code_verifier for access + refresh tokens

**Security Requirements (from research):**
- PKCE with S256 challenge method is mandatory for public clients
- State parameter must be cryptographically random (use `crypto.randomUUID()`)
- Store state temporarily and validate on callback
- Request only `read` and `offline_access` scopes (no write permissions)

**Token Lifecycle**:
- Access token: 6 hours (21,600 seconds)
- Refresh token: 6 months (single-use - new one issued on each refresh)

**Refresh Token Handling** (from BTG Pactual pattern):
```typescript
let refreshPromise: Promise<string> | null = null;

async function getToken(): Promise<string> {
  if (tokenState && Date.now() < tokenState.expires - REFRESH_BUFFER_MS) {
    return tokenState.access;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const newToken = await refreshMercadoLivreToken(tokenState!);
        await persistTokenAtomically(newToken); // Critical: atomic write
        tokenState = newToken;
        return newToken.access;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}
```

### Read-Only Tools (Simplified)

All tools use **GET requests only**. No POST/PUT/DELETE operations that modify seller data.

**Research Insight (Simplicity):** Reduced from 7 to 4 core tools. Single-item fetches (get_order, get_item) merged into list tools with optional ID parameter.

| Tool | Endpoint | Purpose |
|------|----------|---------|
| `mercadolivre_get_user_info` | `GET /users/me` | Seller account, reputation, site_id |
| `mercadolivre_list_orders` | `GET /orders/search` or `/orders/{id}` | Orders with filters OR single order by ID |
| `mercadolivre_list_items` | `GET /users/{id}/items/search` or `/items/{id}` | Items with filters OR single item by ID |
| `mercadolivre_get_billing` | `GET /billing/integration/...` | Billing periods and details combined |

**Agent-Native Enhancements (from research):**
- Tool descriptions include workflow hints: "Use this first to get seller context before querying orders"
- Responses include `nextAction` suggestions: "To see order details, call with order_id parameter"
- Pagination guidance in responses: "More results available. Set offset=50 for next page"
- All responses include `isReadOnly: true` flag for agent safety confirmation

### Site Detection

Mercado Livre has different sites with endpoint variations:
- **MLB** (Brazil) - Primary target
- **MLA** (Argentina)
- **MLM** (Mexico) - Different billing endpoints
- **MLC** (Chile), **MCO** (Colombia)

Detect site from `/users/me` response (`site_id` field) and route to appropriate endpoints.

### Error Handling

Follow MercadoPago pattern with agent-native errors:

```typescript
class MercadoLivreApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly retryAfter?: number,
    public readonly recoveryHint?: string
  ) {
    super(message);
  }

  toAgentError() {
    return {
      error: this.message,
      status: this.status,
      recoverable: this.status === 429 || this.status >= 500,
      hint: this.recoveryHint ?? this.getDefaultHint(),
    };
  }

  private getDefaultHint(): string {
    if (this.status === 401) return "Token expired. Re-authenticate.";
    if (this.status === 429) return "Rate limited. Wait and retry.";
    if (this.status >= 500) return "Mercado Livre service issue. Retry shortly.";
    return "Check request parameters.";
  }
}
```

### Rate Limit Handling

| Endpoint | Limit | Strategy |
|----------|-------|----------|
| Orders search | 100 req/min | Separate bucket, exponential backoff on 429 |
| General API | 1500 req/min | Standard retry |

**Performance Insights (from research):**
- Use separate rate limit buckets per endpoint type
- AbortController with 15s timeout on all requests
- Parse `Retry-After` header when present

Implement retry with exponential backoff:
```typescript
const RETRY_CONFIG = {
  attempts: 3,
  minDelayMs: 500,
  maxDelayMs: 30_000,
  jitter: 0.1,
  shouldRetry: (err) => err.status === 429 || err.status >= 500,
};

// Use AbortController for cancellation
const controller = new AbortController();
const timeout = setTimeout(() => controller.abort(), 15_000);
try {
  const response = await fetch(url, { signal: controller.signal });
} finally {
  clearTimeout(timeout);
}
```

## Implementation Phases

### Phase 1: Foundation (Core Setup)

**Files to create:**

#### `extensions/mercadolivre-mcp/openclaw.plugin.json`

```json
{
  "id": "mercadolivre-mcp",
  "name": "Mercado Livre (Read-Only)",
  "description": "Read-only access to Mercado Livre seller data for financial reporting",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "clientId": {
        "type": "string",
        "description": "Mercado Livre App ID"
      },
      "clientSecret": {
        "type": "string",
        "description": "Mercado Livre App Secret"
      }
    },
    "required": ["clientId", "clientSecret"]
  }
}
```

#### `extensions/mercadolivre-mcp/package.json`

```json
{
  "name": "@openclaw/mercadolivre-mcp",
  "version": "2026.2.1",
  "type": "module",
  "dependencies": {
    "@sinclair/typebox": "0.34.47",
    "zod": "^4.3.6"
  }
}
```

#### `extensions/mercadolivre-mcp/src/types.ts`

```typescript
import { z } from "zod";

export const ConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
});

export type MercadoLivreConfig = z.infer<typeof ConfigSchema>;

export const TokenSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("bearer"),
  expires_in: z.number(),
  scope: z.string(),
  user_id: z.number(),
  refresh_token: z.string(),
});

export const UserSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  site_id: z.string(),
  seller_reputation: z.object({
    level_id: z.string().nullable(),
    power_seller_status: z.string().nullable(),
    transactions: z.object({
      completed: z.number(),
      canceled: z.number(),
    }),
  }).optional(),
});
```

### Phase 2: Authentication

**Files to create:**

#### `extensions/mercadolivre-mcp/src/auth.ts`

OAuth2 Authorization Code flow with:
- Authorization URL generation with state parameter
- Code exchange for tokens
- Token refresh with deduplication
- Atomic token persistence

### Phase 3: API Client

#### `extensions/mercadolivre-mcp/src/client.ts`

```typescript
import { z } from "zod";
import { retryAsync } from "../../src/infra/retry.js";

const BASE_URL = "https://api.mercadolibre.com";

export class MercadoLivreApiError extends Error {
  // ... error implementation
}

export async function fetchMercadoLivre<T>(
  endpoint: string,
  accessToken: string,
  schema: z.ZodSchema<T>
): Promise<T> {
  return retryAsync(
    async () => {
      const response = await fetch(`${BASE_URL}${endpoint}`, {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          Accept: "application/json",
        },
        signal: AbortSignal.timeout(15_000),
      });

      if (!response.ok) {
        // Handle errors with recovery hints
      }

      const data = await response.json();
      return schema.parse(data);
    },
    RETRY_CONFIG
  );
}
```

### Phase 4: Read-Only Tools

Create each tool following this pattern:

#### `extensions/mercadolivre-mcp/src/tools/get-user-info.ts`

```typescript
import { Type } from "@sinclair/typebox";
import { fetchMercadoLivre, UserSchema } from "../client.js";

export function createGetUserInfoTool(getToken: () => Promise<string>) {
  return {
    name: "mercadolivre_get_user_info",
    description: "Get Mercado Livre seller account info and reputation. Read-only operation.",
    parameters: Type.Object({}),

    async execute() {
      const token = await getToken();
      const user = await fetchMercadoLivre("/users/me", token, UserSchema);

      return {
        content: [{
          type: "text" as const,
          text: `Seller: ${user.nickname} (ID: ${user.id})\nSite: ${user.site_id}\nReputation: ${user.seller_reputation?.level_id ?? 'N/A'}`,
        }],
        structuredContent: user,
      };
    },
  };
}
```

#### Additional Tools to Implement

| Tool File | Parameters | Description |
|-----------|------------|-------------|
| `list-orders.ts` | `status?`, `date_from?`, `date_to?`, `limit?` | List orders with filters |
| `get-order.ts` | `order_id` | Get single order details |
| `list-items.ts` | `status?`, `limit?` | List product listings |
| `get-item.ts` | `item_id` | Get single item details |
| `get-billing-periods.ts` | `group?` (ML/MP), `limit?` | Get billing periods |
| `get-billing-details.ts` | `period_key`, `group` | Get billing reconciliation |

### Phase 5: Plugin Entry Point

#### `extensions/mercadolivre-mcp/index.ts`

```typescript
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { ConfigSchema } from "./src/types.js";
import { createAuthManager } from "./src/auth.js";
import { createGetUserInfoTool } from "./src/tools/get-user-info.js";
import { createListOrdersTool } from "./src/tools/list-orders.js";
// ... other tool imports

export default function register(api: OpenClawPluginApi) {
  const configResult = ConfigSchema.safeParse(api.pluginConfig);
  if (!configResult.success) {
    return; // Optional plugin - skip if not configured
  }

  const config = configResult.data;
  const auth = createAuthManager(api, config);

  // Register OAuth provider for authentication
  api.registerProvider({
    id: "mercadolivre",
    label: "Mercado Livre",
    envVars: ["MERCADOLIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_SECRET"],
    auth: [{
      id: "authorization_code",
      label: "Browser Authorization",
      kind: "authorization_code",
      run: async (ctx) => auth.runOAuthFlow(ctx),
    }],
  });

  // Register read-only tools
  api.registerTool(createGetUserInfoTool(auth.getToken), { optional: true });
  api.registerTool(createListOrdersTool(auth.getToken), { optional: true });
  api.registerTool(createGetOrderTool(auth.getToken), { optional: true });
  api.registerTool(createListItemsTool(auth.getToken), { optional: true });
  api.registerTool(createGetItemTool(auth.getToken), { optional: true });
  api.registerTool(createGetBillingPeriodsTool(auth.getToken), { optional: true });
  api.registerTool(createGetBillingDetailsTool(auth.getToken), { optional: true });
}
```

## Acceptance Criteria

### Functional Requirements

- [ ] OAuth2 authorization code flow works on VPS (manual URL paste)
- [ ] Token refresh handles single-use refresh tokens correctly
- [ ] All 7 read-only tools work correctly
- [ ] Site detection routes to correct endpoints (MLB vs MLM)
- [ ] Rate limiting handled gracefully with retry
- [ ] Error messages include recovery hints

### Non-Functional Requirements

- [ ] No POST/PUT/DELETE operations that modify data
- [ ] No write scope requested in OAuth
- [ ] 15-second request timeout on all API calls
- [ ] Zod validation on all API responses
- [ ] Atomic token persistence (no data loss on refresh)

### Security Requirements

- [ ] Tokens stored in memory only during runtime
- [ ] Client secret not logged or exposed
- [ ] State parameter validated in OAuth flow
- [ ] No sensitive data in error messages

### Testing Requirements

- [ ] Unit tests for token refresh deduplication
- [ ] Unit tests for Zod schema validation
- [ ] Live test file for manual API verification
- [ ] Test with expired token scenario

## Success Metrics

- Plugin loads without errors when configured
- All tools accessible after OAuth authentication
- Can retrieve billing data for DRE/Balanço calculations
- Token refresh works seamlessly across 6-hour boundary

## Dependencies & Prerequisites

- Mercado Livre developer account
- App registered at https://developers.mercadolivre.com.br
- App permissions: `read`, `offline_access`
- Seller account with KYC completed

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| Refresh token persistence failure | Medium | High | Atomic write with temp file + rename |
| Rate limit exhaustion | Medium | Medium | Exponential backoff, request queuing |
| Site endpoint differences | Low | High | Site detection from `/users/me` |
| OAuth scope insufficient | Low | High | Document exact scope requirements |

## Future Considerations

- Add billing report download (CSV) for detailed reconciliation
- Add Flex/Fulfillment/Insurtech billing details (site-specific)
- Add tax perceptions for Argentina (MLA)
- Add multi-account support

## References & Research

### Internal References

- `/Users/danielfirmida/openclawn/extensions/mercadopago-mcp/` - Similar financial integration
- `/Users/danielfirmida/openclawn/extensions/btg-pactual/` - OAuth and token handling patterns
- `/Users/danielfirmida/openclawn/docs/solutions/integration-patterns/mercadopago-cfo-cashflow-extension.md`
- `/Users/danielfirmida/openclawn/docs/solutions/integration-patterns/btg-pactual-banking-mcp-implementation.md`

### External References

- [Mercado Livre Authentication](https://developers.mercadolivre.com.br/en_us/authentication-and-authorization)
- [Mercado Livre Billing Reports](https://developers.mercadolivre.com.br/en_us/billing-reports)
- [Mercado Livre Orders API](https://developers.mercadolivre.com.br/en_us/order-management)
- [Mercado Livre Items API](https://developers.mercadolivre.com.br/en_us/items-and-searches)

### Key API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/oauth/token` | POST | Token exchange/refresh |
| `/users/me` | GET | Current user info |
| `/orders/search` | GET | List orders (100 req/min) |
| `/orders/{id}` | GET | Order details |
| `/users/{id}/items/search` | GET | List items |
| `/items/{id}` | GET | Item details |
| `/billing/integration/monthly/periods` | GET | Billing periods |
| `/billing/integration/periods/key/{key}/group/{group}/details` | GET | Billing details |
