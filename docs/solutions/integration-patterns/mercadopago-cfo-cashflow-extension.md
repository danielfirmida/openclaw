---
title: "MercadoPago CFO Cashflow MCP Extension Implementation"
date: 2026-01-31
tags:
  - mcp
  - mercadopago
  - cashflow
  - csv-parsing
  - zod
  - typebox
  - retry-logic
  - streaming-parser
  - formula-injection
  - agent-native
category: integration-patterns
module: extensions/mercadopago-mcp
symptoms:
  - AI assistant unable to query MercadoPago balance or transactions
  - Need CFO-like cashflow analysis from payment provider
  - Require structured financial summaries for date ranges
severity: medium
root_cause: |
  MercadoPago Release Report API uses async report generation requiring polling,
  CSV responses need streaming parse with formula injection protection,
  and agent-native error design enables AI recovery from transient failures.
related_docs:
  - /docs/solutions/integration-patterns/btg-pactual-banking-mcp-implementation.md
  - /extensions/lobster/
  - /extensions/llm-task/
---

# MercadoPago CFO Cashflow MCP Extension

## Problem Summary

Implement a CFO-like cashflow tracking integration for OpenClaw that enables AI assistants to query MercadoPago business account information (balances, transactions, cashflow summaries) using the Release Report API with proper CSV parsing and agent-native error handling.

## Key Challenges Solved

1. **Async Report Generation**: Release Report API requires POST to trigger, then polling to download
2. **CSV Parsing with Security**: Streaming parser with formula injection protection for spreadsheet safety
3. **Agent-Native Errors**: Structured errors with `recoveryHint` enable AI self-recovery
4. **Negative Number Handling**: CSV sanitizer preserves legitimate negative values like `-75.00`
5. **Tool Registration Pattern**: Uses `api.registerTool()` following lobster extension pattern

## Solution Architecture

```
extensions/mercadopago-mcp/
├── index.ts              # Plugin entry, config validation, tool registration (22 LOC)
├── openclaw.plugin.json  # Plugin manifest
├── package.json          # Dependencies
└── src/
    ├── types.ts          # Zod schemas for config and API responses (57 LOC)
    ├── client.ts         # API client with retry logic (112 LOC)
    ├── csv-parser.ts     # Streaming CSV with injection protection (101 LOC)
    ├── client.test.ts    # 12 tests for API client
    ├── csv-parser.test.ts # 12 tests for CSV parser
    └── tools/
        ├── get-balance.ts       # Balance query (49 LOC)
        ├── get-cashflow.ts      # Cashflow summary with polling (131 LOC)
        └── list-transactions.ts # Transaction listing (152 LOC)
```

### Tools Implemented

| Tool | Purpose | Parameters |
|------|---------|------------|
| `mercadopago_get_balance` | Get current available and pending balance | None |
| `mercadopago_get_cashflow` | Get money in/out summary for date range | `start_date`, `end_date` |
| `mercadopago_list_transactions` | List recent transactions with filters | `limit`, `date_from`, `date_to` |

## Implementation Patterns

### 1. Plugin Registration with Silent Skip

```typescript
// index.ts - Silently skips if not configured (optional extension)
export default function register(api: OpenClawPluginApi) {
  const configResult = MercadoPagoConfigSchema.safeParse(api.pluginConfig);
  if (!configResult.success) {
    return; // Optional extension - skip if no config
  }

  const config = configResult.data;
  api.registerTool(createGetBalanceTool(config), { optional: true });
  api.registerTool(createGetCashflowTool(config), { optional: true });
  api.registerTool(createListTransactionsTool(config), { optional: true });
}
```

### 2. Agent-Native Error Design

```typescript
// client.ts - Structured errors for AI recovery
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

  // Agent-native: structured error for AI self-recovery
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
```

### 3. Retry Logic with Exponential Backoff

```typescript
// client.ts - Uses retryAsync with jitter for rate limits
export async function fetchMercadoPago<T>(
  path: string,
  token: string,
  schema: z.ZodType<T>,
  options?: { method?: string; body?: unknown },
): Promise<T> {
  return retryAsync(
    async () => { /* fetch logic */ },
    {
      attempts: 3,
      minDelayMs: 500,
      maxDelayMs: 30_000,
      jitter: 0.1,
      shouldRetry: (err) =>
        err instanceof MercadoPagoApiError && (err.status === 429 || err.status >= 500),
      retryAfterMs: (err) =>
        err instanceof MercadoPagoApiError && err.retryAfter ? err.retryAfter * 1000 : undefined,
    },
  );
}
```

### 4. Streaming CSV Parser with Injection Protection

```typescript
// csv-parser.ts - Protects against formula injection while preserving negatives
function sanitizeValue(value: string): string {
  // Formula injection: =, @, + followed by non-numbers
  if (/^[=@]/.test(value)) {
    return `'${value}`;
  }
  // For + and -, only sanitize if NOT a valid number
  if (/^[+-]/.test(value) && !/^[+-]?\d+\.?\d*$/.test(value)) {
    return `'${value}`;
  }
  if (/^[\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

// Generator-based streaming for memory efficiency
export function* parseCSVStream(csv: string): Generator<CsvRow> {
  const lines = csv.split("\n");
  const headers = parseCSVLine(lines[0]);

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const values = parseCSVLine(line);
    const row: CsvRow = {};
    for (let j = 0; j < headers.length; j++) {
      row[headers[j]] = sanitizeValue(values[j] ?? "");
    }
    yield row;
  }
}
```

### 5. Report Polling with Exponential Backoff

```typescript
// get-cashflow.ts - Polls for async report completion
async execute(_id: string, params: { start_date: string; end_date: string }) {
  // Step 1: Generate report
  const report = await fetchMercadoPago(
    "/v1/account/release_report",
    config.accessToken,
    ReportResponseSchema,
    { method: "POST", body: { begin_date: `${start_date}T00:00:00Z`, end_date: `${end_date}T23:59:59Z` } },
  );

  // Step 2: Poll for report with exponential backoff
  const maxAttempts = 12;
  let delay = 5000;

  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    await new Promise((r) => setTimeout(r, delay));

    try {
      const csv = await fetchMercadoPagoRaw(
        `/v1/account/release_report/${report.file_name}`,
        config.accessToken,
      );
      // Parse and return results
      const { totalInflow, totalOutflow, transactionCount } = aggregateCashflow(csv);
      return { /* structured result */ };
    } catch (error) {
      if (error instanceof MercadoPagoApiError && error.status === 404) {
        delay = Math.min(delay * 1.5, 30000); // Max 30 seconds
        continue;
      }
      throw error;
    }
  }
  // Timeout after max attempts
  return { status: "timeout", report_id: report.file_name };
}
```

## Configuration

### Plugin Config (openclaw.json)

```json
{
  "plugins": {
    "mercadopago-mcp": {
      "accessToken": "APP_USR-xxxxxxxxxxxx",
      "environment": "production"
    }
  }
}
```

### Environment Variables Alternative

```bash
MERCADOPAGO_ACCESS_TOKEN=APP_USR-xxxxxxxxxxxx
MERCADOPAGO_ENVIRONMENT=production
```

## Best Practices Checklist

### API Integration
- [x] Zod schema validation on all API responses
- [x] Custom error class with agent-native `toAgentError()`
- [x] Retry with exponential backoff for 429 and 5xx
- [x] Respect Retry-After header when present

### CSV Security
- [x] Formula injection protection (`=`, `+`, `-`, `@`, `\t`, `\r`)
- [x] Preserve legitimate negative numbers (`-75.00` stays numeric)
- [x] Generator-based streaming for memory efficiency
- [x] Proper quoted field handling

### Tool Design
- [x] TypeBox for parameter schemas
- [x] Structured output with `content` and `structuredContent`
- [x] Graceful timeout handling with report ID for retry
- [x] Optional tools with `{ optional: true }`

### Security
- [x] Silent skip when not configured (no error exposure)
- [x] Token passed in headers, never logged
- [x] Read-only operations only
- [x] Recovery hints for AI self-healing

## Common Pitfalls Avoided

| Pitfall | Risk | Solution |
|---------|------|----------|
| Sanitizing negative numbers | Breaks financial data | Check if value is valid number before sanitizing |
| No retry logic | Transient failures break flows | Exponential backoff with jitter |
| Hardcoding poll delays | Slow or aggressive polling | Exponential backoff (5s → 30s max) |
| Blocking on report generation | 60+ second timeouts | Async polling with max attempts |
| Missing structured errors | AI can't self-recover | `toAgentError()` with recovery hints |

## Test Coverage

### CSV Parser Tests (12 tests)
- Formula injection protection (`=SUM()`, `+cmd`, `@dangerous`)
- Negative number preservation (`-75`, `-3.14`)
- Quoted field handling (commas in quotes, escaped quotes)
- Empty lines and whitespace handling
- Cashflow aggregation with mixed credits/debits

### API Client Tests (12 tests)
- Successful fetch with Zod validation
- 401/429/500 error handling
- Retry-After header parsing
- Agent error structure verification
- Raw CSV download (404 handling for pending reports)

## Related Files

- **Tool pattern**: `extensions/lobster/` (registerTool usage)
- **Similar integration**: `extensions/llm-task/` (polling pattern)
- **BTG Banking**: `extensions/btg-pactual/` (OAuth + banking)
- **Plugin types**: `src/plugins/types.ts`

## Future Enhancements

1. **Period Comparison**: Compare cashflow between two date ranges
2. **Anomaly Detection**: Flag unusual transactions based on historical patterns
3. **Webhook Support**: Real-time notifications instead of polling
4. **Multi-account**: Support for multiple MercadoPago accounts

## References

- [MercadoPago Release Report API](https://www.mercadopago.com.br/developers/pt/docs/sales-processing/reports/release-report)
- [MercadoPago Balance API](https://www.mercadopago.com.br/developers/pt/reference/account/_account_balance/get)
- PR: https://github.com/danielfirmida/openclaw/pull/1
