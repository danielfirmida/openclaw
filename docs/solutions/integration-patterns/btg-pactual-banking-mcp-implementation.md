---
title: "BTG Pactual Read-Only Banking MCP Extension Implementation"
date: 2026-01-31
tags:
  - mcp
  - oauth
  - banking
  - btg-pactual
  - device-code-flow
  - pkce
  - zod
  - typebox
  - token-refresh
  - vps-deployment
category: integration-patterns
module: extensions/btg-pactual
symptoms:
  - AI assistant unable to query bank account information
  - Need secure OAuth2 authentication for VPS/headless servers
  - Require read-only banking API access without write permissions
severity: medium
root_cause: |
  Building secure banking integration requires OAuth2 device code flow for VPS compatibility,
  token refresh deduplication to prevent race conditions, and read-only scope limiting for safety.
related_docs:
  - /docs/solutions/integration-issues/openclaw-docker-tailscale-pairing-required.md
  - /extensions/qwen-portal-auth/oauth.ts
  - /extensions/mercadopago-mcp/
---

# BTG Pactual Read-Only Banking MCP Extension

## Problem Summary

Implement a secure, read-only banking integration for OpenClaw that enables AI assistants to query BTG Pactual business account information (accounts, balances, transactions) without exposing write operations.

## Key Challenges Solved

1. **VPS/Headless OAuth**: Device code flow with PKCE works without browser automation
2. **Token Refresh Race Conditions**: Single-promise deduplication pattern prevents concurrent refreshes
3. **Read-Only Safety**: Only `*:read` scopes requested; no transfer/payment endpoints exposed
4. **Runtime API Validation**: Zod schemas catch API contract changes early

## Solution Architecture

```
extensions/btg-pactual/
├── index.ts    # Plugin registration, token manager, 3 tools (354 LOC)
├── oauth.ts    # Device code flow with PKCE (225 LOC)
└── README.md   # Setup documentation
```

### Tools Implemented

| Tool | Purpose | Parameters |
|------|---------|------------|
| `btg_list_accounts` | List all accessible accounts | None |
| `btg_get_balance` | Get balance for an account | `account_id` |
| `btg_list_transactions` | Query transaction history | `account_id`, `start_date`, `end_date`, `limit`, `cursor` |

## Implementation Patterns

### 1. OAuth Device Code Flow with PKCE

```typescript
// oauth.ts - PKCE generation
function generatePkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// VPS-compatible: falls back to manual URL if browser open fails
try {
  await params.openUrl(verificationUrl);
} catch {
  // User copies URL from terminal to browser
}
```

### 2. Token Refresh Deduplication

```typescript
// index.ts - Prevents thundering herd on concurrent requests
let refreshPromise: Promise<string> | null = null;

async function getToken(api: OpenClawPluginApi): Promise<string> {
  if (tokenState && Date.now() < tokenState.expires - REFRESH_BUFFER_MS) {
    return tokenState.access;
  }

  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const newToken = await refreshBtgOAuth(tokenState!, getClientId());
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

### 3. Request Timeouts with AbortController

```typescript
// index.ts - 15-second timeout on all API calls
async function btgFetch<T>(endpoint: string, token: string, schema: z.ZodType<T>): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch(`${BTG_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        "x-request-id": crypto.randomUUID(),
      },
      signal: controller.signal,
    });
    return schema.parse(await res.json());
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### 4. Zod Runtime Validation

```typescript
// All API responses validated against schemas
const BtgBalanceSchema = z.object({
  account_id: z.string(),
  available_balance: z.number(),
  total_balance: z.number(),
  currency: z.string(),
  as_of: z.string(),
});

// Throws ZodError if API contract changes
const balance = BtgBalanceSchema.parse(await res.json());
```

## Configuration

### Environment Variables

```bash
BTG_CLIENT_ID=your_client_id_from_btg_portal
```

### VPS/Docker Deployment

For Docker with Tailscale Serve:

```json
{
  "gateway": {
    "trustedProxies": ["172.18.0.1"]
  }
}
```

## Best Practices Checklist

### OAuth & Authentication
- [x] Use PKCE with S256 challenge (never plain)
- [x] Device code flow for VPS compatibility
- [x] Graceful fallback when openUrl fails
- [x] Request minimal scopes (read-only only)

### Token Management
- [x] Store tokens in memory only (never persist)
- [x] 15-minute refresh buffer before expiration
- [x] Single-promise deduplication for refresh
- [x] Clear token state on 401 responses

### Request Safety
- [x] 15-second timeout on all fetch calls
- [x] AbortController for cancellation
- [x] x-request-id header for tracing
- [x] Truncate error responses (≤200 chars)

### Security
- [x] Read-only scopes only
- [x] Disable tools in sandboxed agents
- [x] Never log tokens or account numbers
- [x] Include recovery hints in errors

## Common Pitfalls Avoided

| Pitfall | Risk | Solution |
|---------|------|----------|
| No request timeouts | Hanging connections | AbortController + 15s timeout |
| Token refresh race | API rate limits | Single-promise deduplication |
| Missing validation | Silent API changes | Zod schemas on all responses |
| Logging tokens | Credential exposure | Never log bearer tokens |
| Over-broad scopes | Attack surface | Read-only scopes only |

## Related Files

- **OAuth pattern**: `extensions/qwen-portal-auth/oauth.ts`
- **MCP tool pattern**: `extensions/mercadopago-mcp/src/tools/`
- **VPS deployment**: `docs/solutions/integration-issues/openclaw-docker-tailscale-pairing-required.md`
- **Plugin types**: `src/plugins/types.ts`

## Testing Recommendations

1. **Unit tests for OAuth**: Mock device code and token polling
2. **Token refresh tests**: Verify deduplication with concurrent calls
3. **Tool execution tests**: Mock btgFetch responses
4. **Timeout tests**: Verify 15-second limit enforced
5. **Error sanitization**: Confirm tokens redacted from logs

## References

- [BTG Pactual Developer Portal](https://developers.empresas.btgpactual.com/docs)
- [OAuth 2.0 Device Code Flow (RFC 8628)](https://datatracker.ietf.org/doc/html/rfc8628)
- [PKCE for OAuth (RFC 7636)](https://datatracker.ietf.org/doc/html/rfc7636)
- PR: https://github.com/danielfirmida/openclaw/pull/2
