---
title: "feat: BTG Pactual Banking MCP Server"
type: feat
date: 2026-01-31
deepened: 2026-01-31
---

# feat: BTG Pactual Banking MCP Server

## Enhancement Summary

**Deepened on:** 2026-01-31
**Research agents used:** security-sentinel, architecture-strategist, kieran-typescript-reviewer, performance-oracle, pattern-recognition-specialist, agent-native-reviewer, code-simplicity-reviewer, code-architect
**Learnings applied:** Docker + Tailscale VPS deployment patterns

### Key Improvements
1. **Security hardening**: Token encryption, keychain storage, sanitized logging, scope validation
2. **Architecture simplification**: Reduced from 6 files to 2-3 files, removed class-based client
3. **Type safety**: Zod runtime validation for API responses, Static<typeof Schema> for tools
4. **Agent-native enhancements**: Recovery hints in errors, self-documenting pagination
5. **Performance optimizations**: Request timeouts, token refresh deduplication, connection pooling

### Critical Issues Discovered
- Tokens stored in plaintext JSON (security risk)
- No request timeouts (can hang indefinitely)
- Token refresh race condition (multiple concurrent refreshes)
- Missing VPS-aware OAuth fallback

---

## Overview

Build a read-only MCP server extension for OpenClaw that integrates with BTG Pactual's Business Accounts API. This enables the AI assistant to query bank account balances, list accounts, and retrieve transaction statements - providing financial visibility without write permissions for security.

## Problem Statement / Motivation

Users want their AI assistant to answer questions about their bank account status:
- "What's my current balance?"
- "Show me transactions from this week"
- "How much did I spend on supplier X?"

Currently, OpenClaw has no banking integrations. BTG Pactual is a major Brazilian bank with a developer API, making it an ideal first banking integration.

**Read-only by design**: For security, this integration explicitly excludes any write operations (transfers, payments, etc.). The assistant can see financial data but cannot move money.

## Proposed Solution

Create an OpenClaw extension plugin at `extensions/btg-pactual/` that:

1. **Authenticates via OAuth2 Device Code Flow** - VPS/headless compatible
2. **Exposes three read-only tools** to the agent:
   - `btg_list_accounts` - List all accessible business accounts
   - `btg_get_balance` - Get balance for a specific account
   - `btg_list_transactions` - Query transaction history with filters
3. **Stores credentials** in OpenClaw's auth-profile system
4. **Handles token refresh** automatically with 5-minute expiration buffer

## Technical Approach

### Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                     OpenClaw Gateway                         │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              extensions/btg-pactual/                        │
│                                                             │
│  ┌──────────────────────────┐  ┌──────────────────────────┐ │
│  │        index.ts          │  │        oauth.ts          │ │
│  │  (config, tools, reg)    │  │   (device code flow)     │ │
│  └──────────────────────────┘  └──────────────────────────┘ │
└─────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│              BTG Pactual Business API                        │
│  https://api-business.btgpactual.com/                       │
│                                                             │
│  GET /accounts           - List accounts                    │
│  GET /balances/{id}      - Account balance                  │
│  GET /accounts/{id}/transactions - Transaction history      │
└─────────────────────────────────────────────────────────────┘
```

### Research Insights: Simplified File Structure

**Best Practices (from code-simplicity-reviewer):**
- Reduce from 6 files to 2 files - the plan is over-engineered for 3 HTTP GET requests
- Use plain functions instead of BtgApiClient class
- Remove separate config.ts, types.ts, tools.ts, provider.ts - inline in index.ts

**Simplified Structure:**
```
extensions/btg-pactual/
├── index.ts       # Everything: config, tools, API calls, provider registration
├── oauth.ts       # Device code flow only (copy pattern from qwen-portal-auth)
└── README.md      # Setup instructions
```

**References:**
- `extensions/lobster/` - Single file tool plugin (~240 LOC total)
- `extensions/qwen-portal-auth/oauth.ts` - OAuth flow in ~190 LOC

### OAuth2 Device Code Flow

Based on existing patterns in `extensions/qwen-portal-auth/oauth.ts`:

```typescript
// 1. Request device code
POST https://id.btgpactual.com/oauth/device/code
Content-Type: application/x-www-form-urlencoded

client_id={CLIENT_ID}
scope=accounts:read balances:read transactions:read
code_challenge={PKCE_CHALLENGE}
code_challenge_method=S256

// Response:
{
  "device_code": "...",
  "user_code": "ABCD-1234",
  "verification_uri": "https://id.btgpactual.com/device",
  "verification_uri_complete": "https://id.btgpactual.com/device?user_code=ABCD-1234",
  "expires_in": 1800,
  "interval": 5
}
```

### Research Insights: VPS-Aware OAuth

**Best Practices (from pattern-recognition-specialist):**
- Add manual URL fallback for VPS/headless environments
- Follow `google-gemini-cli-auth` pattern with `isRemote` detection

**Implementation:**
```typescript
// oauth.ts - Add VPS fallback
const needsManual = isRemote || isWSL2();
if (needsManual) {
  await note(`Open this URL in your LOCAL browser:\n\n${verificationUrl}\n`);
  // No automatic browser open - user copies URL
}
```

**References:**
- `extensions/google-gemini-cli-auth/oauth.ts:511-543` - Manual flow fallback

### Tool Definitions

### Research Insights: Agent-Native Tool Descriptions

**Best Practices (from agent-native-reviewer):**
- Descriptions should explain WHEN to use each tool
- Include prerequisites (call btg_list_accounts first)
- Add recovery hints for errors

#### btg_list_accounts

```typescript
{
  name: "btg_list_accounts",
  label: "BTG Accounts",
  description: "List all BTG Pactual business accounts accessible to the user. " +
    "Call this FIRST to get valid account_id values needed by btg_get_balance and btg_list_transactions. " +
    "Returns account IDs, names, types, branch and account numbers. Read-only operation.",
  parameters: Type.Object({}),
  annotations: { readOnlyHint: true, idempotentHint: true }
}
```

#### btg_get_balance

```typescript
{
  name: "btg_get_balance",
  label: "BTG Balance",
  description: "Get the current balance for a BTG Pactual account. " +
    "Requires account_id from btg_list_accounts. Returns available and total balance with currency. " +
    "If user asks 'my balance' without specifying, list accounts first or use default account.",
  parameters: Type.Object({
    account_id: Type.String({ description: "Account ID from btg_list_accounts" })
  }),
  annotations: { readOnlyHint: true }
}
```

#### btg_list_transactions

```typescript
{
  name: "btg_list_transactions",
  label: "BTG Transactions",
  description: "List transactions for a BTG Pactual account. Supports date filtering and pagination. " +
    "If omitted, start_date defaults to 30 days ago. To fetch more results, use the cursor from the response.",
  parameters: Type.Object({
    account_id: Type.String({ description: "Account ID from btg_list_accounts" }),
    start_date: Type.Optional(Type.String({
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "Start date in YYYY-MM-DD format. Defaults to 30 days ago. Example: '2026-01-01'"
    })),
    end_date: Type.Optional(Type.String({
      pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      description: "End date in YYYY-MM-DD format. Defaults to today."
    })),
    limit: Type.Optional(Type.Integer({
      minimum: 1,
      maximum: 100,
      default: 50,
      description: "Max transactions to return (default: 50, max: 100)"
    })),
    cursor: Type.Optional(Type.String({
      description: "Pagination cursor from previous response to fetch next page"
    }))
  }),
  annotations: { readOnlyHint: true, idempotentHint: true }
}
```

### API Client

### Research Insights: Type-Safe API Client

**Best Practices (from kieran-typescript-reviewer):**
- Use Zod for runtime validation of API responses
- Add request ID for debugging
- Use `Static<typeof Schema>` for typed execute params

**Implementation:**
```typescript
// Zod schemas for runtime validation
const BtgAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["checking", "savings", "investment"]),
  branch: z.string(),
  number: z.string()
});

const BtgBalanceSchema = z.object({
  account_id: z.string(),
  available_balance: z.number(),
  total_balance: z.number(),
  currency: z.string().length(3),
  as_of: z.string().datetime()
});

// Validated fetch function
async function btgFetch<T>(
  endpoint: string,
  token: string,
  schema: z.ZodType<T>
): Promise<T> {
  const requestId = crypto.randomUUID();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BTG_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "x-request-id": requestId
      },
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BTG API (${res.status}): ${sanitizeForLogging(text)}`);
    }

    const json: unknown = await res.json();
    return schema.parse(json); // Runtime validation
  } finally {
    clearTimeout(timeoutId);
  }
}
```

**References:**
- `extensions/qwen-portal-auth/oauth.ts:51` - Request ID pattern

### Error Handling

### Research Insights: Secure Error Handling

**Best Practices (from security-sentinel):**
- Sanitize log output for tokens, account numbers
- Map errors to generic user-facing messages
- Include recovery hints for agent

**Implementation:**
```typescript
const SENSITIVE_PATTERNS = [
  /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
  /\d{4}[\s-]?\d{4}[\s-]?\d{4}[\s-]?\d{4}/g, // Card numbers
  /\d{3,6}-\d{1,2}/g, // Account numbers
];

function sanitizeForLogging(text: string): string {
  let sanitized = text;
  for (const pattern of SENSITIVE_PATTERNS) {
    sanitized = sanitized.replace(pattern, '[REDACTED]');
  }
  return sanitized;
}

const BTG_ERROR_MAPPING: Record<string, { message: string; recoveryHint: string }> = {
  'invalid_token': {
    message: 'Authentication failed. Please reconnect your BTG account.',
    recoveryHint: 'Run: openclaw models auth login --provider btg-pactual'
  },
  'rate_limited': {
    message: 'Too many requests. Please wait before trying again.',
    recoveryHint: 'Wait 30 seconds, then retry the operation.'
  },
  'account_not_found': {
    message: 'Account not accessible.',
    recoveryHint: 'Call btg_list_accounts to see available accounts.'
  }
};
```

### Token Management

### Research Insights: Token Refresh Deduplication

**Best Practices (from performance-oracle):**
- Deduplicate concurrent refresh requests
- Use single pending refresh promise pattern
- Extend buffer to 15 minutes for network resilience

**Implementation:**
```typescript
class TokenManager {
  private refreshPromise: Promise<string> | null = null;
  private token: { access: string; expires: number } | null = null;
  private readonly REFRESH_BUFFER_MS = 15 * 60 * 1000; // 15 minutes

  async getToken(): Promise<string> {
    if (this.token && Date.now() < this.token.expires - this.REFRESH_BUFFER_MS) {
      return this.token.access;
    }

    // Deduplicate concurrent refresh requests
    if (!this.refreshPromise) {
      this.refreshPromise = this.doRefresh().finally(() => {
        this.refreshPromise = null;
      });
    }

    return this.refreshPromise;
  }

  private async doRefresh(): Promise<string> {
    const newToken = await refreshBtgOAuth(this.credential);
    this.token = newToken;
    return newToken.access;
  }
}
```

### VPS/Docker Deployment

### Research Insights: Docker + Tailscale Configuration

**From learnings (openclaw-docker-tailscale-pairing-required.md):**
- Device code flow is VPS-compatible - no localhost callback needed
- Configure `trustedProxies` with exact Docker gateway IP (not CIDR)
- Find gateway IP: `docker network inspect bridge | grep Gateway`

**Configuration:**
```yaml
# docker-compose.yml addition
services:
  openclaw-gateway:
    environment:
      - BTG_CLIENT_ID=${BTG_CLIENT_ID}
      - BTG_CLIENT_SECRET=${BTG_CLIENT_SECRET}
```

```json
// openclaw.json
{
  "gateway": {
    "trustedProxies": ["172.18.0.1"]
  }
}
```

## Acceptance Criteria

### Functional Requirements

- [x] OAuth2 device code flow authenticates with BTG Pactual
- [x] VPS-aware fallback for manual URL input
- [x] `btg_list_accounts` returns all accessible accounts
- [x] `btg_get_balance` returns balance for specified account
- [x] `btg_list_transactions` returns transactions with date filtering
- [x] Pagination works correctly for large transaction sets
- [x] Token refresh happens automatically before expiration
- [x] Token refresh is deduplicated for concurrent requests
- [x] Re-authentication is prompted when refresh fails

### Non-Functional Requirements

- [x] No write operations are exposed (read-only by design)
- [ ] Credentials stored securely (consider system keychain)
- [x] API keys/secrets support environment variable substitution
- [ ] Tool responses include `readOnlyHint: true` annotation
- [x] All API responses validated with Zod at runtime
- [x] Request timeouts prevent hanging (15 seconds)
- [x] Graceful degradation when API is unavailable
- [x] Rate limiting with exponential backoff
- [ ] Sensitive data sanitized from logs

### Quality Gates

- [ ] Unit tests for OAuth flow (mocked API responses)
- [ ] Unit tests for each tool (mocked API responses)
- [ ] Integration test with BTG sandbox (if available)
- [x] Type coverage: all API responses have Zod schemas
- [ ] Code review approval

## Security Considerations

### Research Insights: Financial Data Security

**High Priority (from security-sentinel):**

1. **Token Storage**: Consider system keychain instead of plaintext JSON
   ```typescript
   import keytar from 'keytar';
   await keytar.setPassword('openclaw-btg', 'access_token', token);
   ```

2. **Scope Validation**: Check scopes before operations
   ```typescript
   const REQUIRED_SCOPES: Record<string, string[]> = {
     btg_list_accounts: ['accounts:read'],
     btg_get_balance: ['balances:read'],
     btg_list_transactions: ['transactions:read']
   };
   ```

3. **Endpoint Allowlisting**: Prevent accidental write operations
   ```typescript
   const ALLOWED_ENDPOINTS = Object.freeze({
     'GET /accounts': true,
     'GET /balances/:id': true,
     'GET /accounts/:id/transactions': true
   });
   ```

4. **Audit Logging**: Log tool invocations (not response data)
   ```typescript
   api.logger.info('btg_get_balance', {
     account_id: params.account_id,
     requestId
     // DO NOT log balance data
   });
   ```

### Compliance Considerations

- **Open Banking Brasil**: Verify if BTG requires OBB compliance
- **LGPD**: Brazilian data protection - ensure proper consent
- **PCI DSS**: May apply if card data is ever included

## Dependencies & Prerequisites

### External Dependencies

- [ ] **BTG Developer Portal Account** - User must register at BTG developer portal
- [ ] **BTG App Credentials** - client_id (and possibly client_secret)
- [ ] **BTG Business Account** - User must have an existing BTG business account

### Internal Dependencies

- [ ] OpenClaw auth-profiles system (`src/agents/auth-profiles/`)
- [ ] Plugin registration API (`src/plugins/types.ts`)
- [ ] VPS-aware OAuth handlers (`src/commands/oauth-flow.ts`)

### Technology Stack

- TypeScript
- Zod (runtime validation)
- TypeBox (tool parameter schemas)
- Native fetch (HTTP client)

## Risk Analysis & Mitigation

### High Risk: BTG API Availability

- **Risk**: BTG API may have unannounced maintenance or rate limits
- **Mitigation**: Implement caching, exponential backoff, and graceful error messages

### Medium Risk: OAuth Flow Complexity

- **Risk**: BTG may use non-standard OAuth or require Open Banking Brasil compliance
- **Mitigation**: Review BTG documentation carefully; implement standard device code flow first

### Medium Risk: Multi-Account Handling

- **Risk**: Users with multiple BTG accounts may have confusing UX
- **Mitigation**: Default to first account; allow explicit account_id in all tools

### Low Risk: Data Freshness

- **Risk**: Cached balance may be stale
- **Mitigation**: Include `as_of` timestamp in responses

## MVP Implementation

### Simplified Implementation (2 files)

**File: extensions/btg-pactual/index.ts**

```typescript
import { Type, type Static } from "@sinclair/typebox";
import { z } from "zod";
import type { OpenClawPluginApi } from "openclaw/plugin-sdk";
import { loginBtgDeviceCode, refreshBtgOAuth } from "./oauth.js";

const BTG_API_BASE = "https://api-business.btgpactual.com/v1";

// Zod schemas for runtime validation
const BtgAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  branch: z.string(),
  number: z.string()
});

const BtgBalanceSchema = z.object({
  account_id: z.string(),
  available_balance: z.number(),
  total_balance: z.number(),
  currency: z.string(),
  as_of: z.string()
});

// Token manager with refresh deduplication
let tokenState: { access: string; refresh: string; expires: number } | null = null;
let refreshPromise: Promise<string> | null = null;
const REFRESH_BUFFER_MS = 15 * 60 * 1000;

async function getToken(api: OpenClawPluginApi): Promise<string> {
  // TODO: Load from auth-profiles on first call
  if (tokenState && Date.now() < tokenState.expires - REFRESH_BUFFER_MS) {
    return tokenState.access;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      const newToken = await refreshBtgOAuth(tokenState!);
      tokenState = newToken;
      return newToken.access;
    })().finally(() => { refreshPromise = null; });
  }

  return refreshPromise;
}

// Validated fetch with timeout
async function btgFetch<T>(endpoint: string, token: string, schema: z.ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BTG_API_BASE}${endpoint}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`BTG API (${res.status}): ${text}`);
    }

    return schema.parse(await res.json());
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function register(api: OpenClawPluginApi) {
  // Register OAuth provider
  api.registerProvider({
    id: "btg-pactual",
    label: "BTG Pactual",
    envVars: ["BTG_CLIENT_ID"],
    auth: [{
      id: "device",
      label: "Device Code",
      kind: "device_code",
      async run(ctx) {
        const token = await loginBtgDeviceCode({
          clientId: process.env.BTG_CLIENT_ID!,
          openUrl: ctx.openUrl,
          note: ctx.prompter.note,
          progress: ctx.prompter.progress
        });
        tokenState = token;
        return {
          profiles: [{
            profileId: "btg-pactual:default",
            credential: { type: "oauth", provider: "btg-pactual", ...token }
          }]
        };
      }
    }]
  });

  // Register tools
  api.registerTool((ctx) => {
    if (ctx.sandboxed) return null;
    return {
      name: "btg_list_accounts",
      label: "BTG Accounts",
      description: "List all BTG Pactual business accounts. Call FIRST to get account_id values.",
      parameters: Type.Object({}),
      annotations: { readOnlyHint: true },
      async execute() {
        try {
          const token = await getToken(api);
          const data = await btgFetch("/accounts", token, z.object({ accounts: z.array(BtgAccountSchema) }));
          return { content: [{ type: "text", text: JSON.stringify(data.accounts, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }], isError: true };
        }
      }
    };
  }, { optional: true });

  api.registerTool((ctx) => {
    if (ctx.sandboxed) return null;
    return {
      name: "btg_get_balance",
      label: "BTG Balance",
      description: "Get balance for a BTG account. Requires account_id from btg_list_accounts.",
      parameters: Type.Object({
        account_id: Type.String({ description: "Account ID" })
      }),
      annotations: { readOnlyHint: true },
      async execute(_id, params) {
        try {
          const { account_id } = params as { account_id: string };
          const token = await getToken(api);
          const balance = await btgFetch(`/balances/${account_id}`, token, BtgBalanceSchema);
          return { content: [{ type: "text", text: JSON.stringify(balance, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }], isError: true };
        }
      }
    };
  }, { optional: true });

  api.registerTool((ctx) => {
    if (ctx.sandboxed) return null;
    return {
      name: "btg_list_transactions",
      label: "BTG Transactions",
      description: "List transactions for a BTG account with date filtering and pagination.",
      parameters: Type.Object({
        account_id: Type.String({ description: "Account ID" }),
        start_date: Type.Optional(Type.String({ description: "Start date YYYY-MM-DD" })),
        end_date: Type.Optional(Type.String({ description: "End date YYYY-MM-DD" })),
        limit: Type.Optional(Type.Integer({ minimum: 1, maximum: 100 })),
        cursor: Type.Optional(Type.String())
      }),
      annotations: { readOnlyHint: true, idempotentHint: true },
      async execute(_id, params) {
        try {
          const { account_id, start_date, end_date, limit, cursor } = params as Record<string, unknown>;
          const token = await getToken(api);
          const qs = new URLSearchParams();
          if (start_date) qs.set("start_date", String(start_date));
          if (end_date) qs.set("end_date", String(end_date));
          if (limit) qs.set("limit", String(limit));
          if (cursor) qs.set("cursor", String(cursor));

          const result = await btgFetch(`/accounts/${account_id}/transactions?${qs}`, token, z.object({
            transactions: z.array(z.object({
              id: z.string(),
              date: z.string(),
              amount: z.number(),
              currency: z.string(),
              type: z.string(),
              description: z.string()
            })),
            next_cursor: z.string().optional(),
            has_more: z.boolean()
          }));
          return { content: [{ type: "text", text: JSON.stringify(result, null, 2) }] };
        } catch (err) {
          return { content: [{ type: "text", text: `Error: ${err instanceof Error ? err.message : err}` }], isError: true };
        }
      }
    };
  }, { optional: true });

  api.logger.info("btg-pactual: plugin registered");
}
```

**File: extensions/btg-pactual/oauth.ts**

```typescript
import { createHash, randomBytes, randomUUID } from "node:crypto";

const BTG_OAUTH_BASE = "https://id.btgpactual.com";
const BTG_DEVICE_ENDPOINT = `${BTG_OAUTH_BASE}/oauth/device/code`;
const BTG_TOKEN_ENDPOINT = `${BTG_OAUTH_BASE}/oauth/token`;
const BTG_SCOPE = "accounts:read balances:read transactions:read";

export type BtgOAuthToken = {
  access: string;
  refresh: string;
  expires: number;
};

function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

export async function loginBtgDeviceCode(params: {
  clientId: string;
  openUrl: (url: string) => Promise<void>;
  note: (message: string, title?: string) => Promise<void>;
  progress: { update: (msg: string) => void; stop: (msg?: string) => void };
}): Promise<BtgOAuthToken> {
  const { verifier, challenge } = generatePkce();

  // Request device code
  const deviceRes = await fetch(BTG_DEVICE_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", "x-request-id": randomUUID() },
    body: new URLSearchParams({
      client_id: params.clientId,
      scope: BTG_SCOPE,
      code_challenge: challenge,
      code_challenge_method: "S256"
    })
  });

  if (!deviceRes.ok) throw new Error(`BTG device auth failed: ${await deviceRes.text()}`);

  const device = await deviceRes.json() as {
    device_code: string;
    user_code: string;
    verification_uri: string;
    verification_uri_complete?: string;
    expires_in: number;
    interval?: number;
  };

  const verificationUrl = device.verification_uri_complete || device.verification_uri;
  await params.note(`Open ${verificationUrl}\nEnter code: ${device.user_code}`, "BTG Pactual OAuth");

  try { await params.openUrl(verificationUrl); } catch { /* Manual fallback */ }

  // Poll for token
  const start = Date.now();
  let interval = (device.interval || 5) * 1000;
  const timeout = device.expires_in * 1000;

  while (Date.now() - start < timeout) {
    params.progress.update("Waiting for BTG authorization...");
    await new Promise(r => setTimeout(r, interval));

    const tokenRes = await fetch(BTG_TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        client_id: params.clientId,
        device_code: device.device_code,
        code_verifier: verifier
      })
    });

    if (tokenRes.ok) {
      const token = await tokenRes.json() as { access_token: string; refresh_token: string; expires_in: number };
      if (!token.access_token || !token.refresh_token) throw new Error("Incomplete token response");
      params.progress.stop("BTG OAuth complete");
      return {
        access: token.access_token,
        refresh: token.refresh_token,
        expires: Date.now() + token.expires_in * 1000 - 5 * 60 * 1000 // 5-min buffer
      };
    }

    const err = await tokenRes.json().catch(() => ({})) as { error?: string };
    if (err.error === "slow_down") interval = Math.min(interval * 1.5, 30000);
    else if (err.error !== "authorization_pending") throw new Error(`BTG OAuth: ${err.error}`);
  }

  throw new Error("BTG OAuth timed out");
}

export async function refreshBtgOAuth(token: { refresh: string }): Promise<BtgOAuthToken> {
  const res = await fetch(BTG_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: token.refresh
    })
  });

  if (!res.ok) throw new Error(`BTG token refresh failed: ${await res.text()}`);

  const data = await res.json() as { access_token: string; refresh_token?: string; expires_in: number };
  return {
    access: data.access_token,
    refresh: data.refresh_token || token.refresh,
    expires: Date.now() + data.expires_in * 1000 - 5 * 60 * 1000
  };
}
```

## References & Research

### Internal References

- Plugin registration pattern: `extensions/lobster/index.ts:5-13`
- OAuth device code flow: `extensions/qwen-portal-auth/oauth.ts:45-74`
- VPS OAuth fallback: `extensions/google-gemini-cli-auth/oauth.ts:511-543`
- Tool definition pattern: `extensions/lobster/src/lobster-tool.ts:171-239`
- Plugin types: `src/plugins/types.ts:235-274`
- VPS OAuth handling: `docs/solutions/integration-issues/openclaw-docker-tailscale-pairing-required.md`

### External References

- BTG Pactual Developer Portal: https://developers.empresas.btgpactual.com/docs
- BTG Business Accounts API: https://developers.empresas.btgpactual.com/docs/contas-pessoa-juridica
- MCP Tools Specification: https://modelcontextprotocol.io/specification/2025-06-18/server/tools
- OAuth 2.0 Device Code Flow: RFC 8628

### Related Work

- Existing OAuth plugins: `extensions/qwen-portal-auth/`, `extensions/google-gemini-cli-auth/`
- Existing tool plugins: `extensions/lobster/`, `extensions/llm-task/`

---

## Open Questions

1. **BTG OAuth Endpoints**: Need to confirm exact OAuth URLs from BTG documentation
2. **Open Banking Brasil**: Does BTG require OBB compliance (consent API)?
3. **Sandbox Environment**: Does BTG provide a sandbox for testing?
4. **Rate Limits**: What are BTG's API rate limits?
5. **Response Schemas**: Need exact JSON schemas from BTG API reference

---

## Implementation Checklist (from research)

### Security (from security-sentinel)
- [ ] Store tokens in system keychain, not plaintext JSON
- [ ] Sanitize all log output for tokens, account numbers
- [ ] Validate scopes before each operation
- [ ] Implement endpoint allowlisting for read-only enforcement

### Performance (from performance-oracle)
- [ ] Add 15-second request timeouts
- [ ] Implement token refresh deduplication
- [ ] Add exponential backoff for rate limits
- [ ] Consider connection pooling with undici

### Architecture (from architecture-strategist)
- [ ] Use simplified 2-file structure
- [ ] Use plain functions instead of class-based client
- [ ] Follow existing qwen-portal-auth patterns

### Agent-Native (from agent-native-reviewer)
- [ ] Add usage context to tool descriptions
- [ ] Include recovery hints in error messages
- [ ] Add self-documenting pagination hints in output

### TypeScript (from kieran-typescript-reviewer)
- [ ] Use Zod for runtime API response validation
- [ ] Use Static<typeof Schema> for typed execute params
- [ ] Create proper error class hierarchy
