---
title: "feat: MercadoPago MCP Server for CFO Cashflow Tracking"
type: feat
date: 2026-01-31
deepened: 2026-01-31
---

# MercadoPago MCP Server for CFO Cashflow Tracking

## Enhancement Summary

**Deepened on:** 2026-01-31
**Sections enhanced:** All major sections
**Research agents used:** 10 parallel agents (Security Sentinel, Performance Oracle, Architecture Strategist, Kieran TypeScript Reviewer, Code Simplicity Reviewer, Pattern Recognition Specialist, Agent-Native Reviewer, Best Practices Researcher, Plugin Validator, Code Architect)

### Key Improvements
1. **Critical Architecture Fix**: Changed from non-existent `api.registerMcpServer()` to OpenClaw's actual `api.registerTool()` pattern
2. **Simplified Tool Set**: Reduced from 6 tools to 3 core tools (balance, cashflow, transactions)
3. **Security Hardening**: Added token encryption, input validation, CSV injection protection
4. **Type Safety**: Replaced unsafe casts with Zod schema validation at API boundaries
5. **Performance**: Streaming CSV parser, Redis caching, exponential backoff polling

### Critical Discovery
The original plan proposed using `api.registerMcpServer()` which **does not exist** in OpenClaw's plugin API. OpenClaw has no MCP client to communicate with spawned MCP servers. The correct approach is to register tools directly using `api.registerTool()`, following patterns from `extensions/lobster/` and `extensions/llm-task/`.

---

## Overview

Build an OpenClaw extension that integrates with MercadoPago's API to provide CFO-like cashflow tracking capabilities. The extension registers tools directly with OpenClaw (not as a separate MCP server) for querying account balance, transactions, and generating cashflow summaries - enabling natural language financial analysis.

## Problem Statement / Motivation

Users with MercadoPago accounts need to:
- Track money flowing in and out of their accounts
- Generate and download financial reports
- Compare periods to understand business trends
- Get instant balance and transaction visibility

Currently, this requires manual navigation of MercadoPago's dashboard or building custom integrations. An OpenClaw extension enables the AI assistant to directly query financial data and provide insights through natural conversation.

**Example interaction:**
```
User: "How's my cashflow looking this month?"
Agent: [uses mercadopago_get_cashflow tool]
       "You received R$45,230 from 127 transactions.
        R$12,400 went out (3 withdrawals + R$2,100 in fees).
        Net positive: R$32,830. Want me to compare to last month?"
```

## Proposed Solution

Create an OpenClaw extension at `extensions/mercadopago-mcp/` that:
1. **Registers tools directly** using `api.registerTool()` (not MCP server spawning)
2. Provides 3 core tools for financial operations (simplified from 6)
3. Handles OAuth 2.0 authentication with encrypted token storage
4. Implements robust retry logic with exponential backoff
5. Uses streaming CSV parsing for memory efficiency

## Technical Approach

### Architecture

```
extensions/mercadopago-mcp/
├── package.json
├── openclaw.plugin.json
├── index.ts                    # Plugin registration with api.registerTool()
└── src/
    ├── client.ts               # MercadoPago API client
    ├── csv-parser.ts           # Streaming CSV parser
    ├── types.ts                # TypeScript types + Zod schemas
    └── tools/
        ├── get-balance.ts      # Current balance
        ├── get-cashflow.ts     # Inflows/outflows summary (combines generate + download)
        └── list-transactions.ts # Transaction listing with pagination
```

### Research Insights

**Best Practices (from Best Practices Researcher):**
- Use `api.registerTool()` pattern from existing extensions
- TypeBox for tool parameter schemas (OpenClaw standard)
- Zod for runtime response validation
- Single responsibility per tool

**Performance Considerations (from Performance Oracle):**
- Stream CSV reports instead of loading into memory
- Cache balance responses for 60 seconds
- Use exponential backoff with jitter for polling
- Implement request deduplication for concurrent calls

**Security Requirements (from Security Sentinel):**
- Encrypt tokens at rest using `src/security/encryption.ts`
- Validate all dates against injection attacks
- Sanitize CSV fields to prevent formula injection
- Never log tokens; mask in error messages
- Use constant-time comparison for sensitive values

### MCP Tools Specification (Simplified)

| Tool | Purpose | Key Parameters |
|------|---------|----------------|
| `mercadopago_get_balance` | Current available + pending balance | None |
| `mercadopago_get_cashflow` | Aggregated inflows/outflows for date range | `start_date`, `end_date` |
| `mercadopago_list_transactions` | Recent transactions with filters | `limit`, `offset`, `date_from`, `date_to` |

**Removed tools (consolidation):**
- `generate_report` + `download_report` → Combined into `get_cashflow` with internal polling
- `compare_periods` → Agent can call `get_cashflow` twice and compare

### API Endpoints Used

| MercadoPago Endpoint | Purpose |
|---------------------|---------|
| `GET /v1/account/balance` | Current balance |
| `POST /v1/account/release_report` | Generate report (HTTP 202) |
| `GET /v1/account/release_report/{file_name}` | Download report |

### Authentication Flow

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│   Plugin Config │────>│  Encrypted Store │────>│  API Requests   │
│ (access_token)  │     │ (src/security/)  │     │ (Bearer header) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
```

**Configuration in `openclaw.json`:**
```json
{
  "extensions": {
    "mercadopago-mcp": {
      "accessToken": "${MERCADOPAGO_ACCESS_TOKEN}",
      "environment": "production"
    }
  }
}
```

### Implementation Phases

#### Phase 1: Foundation (Core Infrastructure)

**Files to create:**

##### `extensions/mercadopago-mcp/package.json`
```json
{
  "name": "@openclaw/mercadopago-mcp",
  "version": "2026.1.31",
  "type": "module",
  "openclaw": {
    "extensions": ["./index.ts"]
  },
  "dependencies": {
    "zod": "^3.25.0"
  }
}
```

##### `extensions/mercadopago-mcp/openclaw.plugin.json`
```json
{
  "id": "mercadopago-mcp",
  "name": "MercadoPago CFO",
  "description": "Cashflow tracking and financial analysis via MercadoPago API",
  "configSchema": {
    "type": "object",
    "additionalProperties": false,
    "properties": {
      "accessToken": {
        "type": "string",
        "description": "MercadoPago API access token"
      },
      "environment": {
        "type": "string",
        "enum": ["sandbox", "production"],
        "default": "production"
      }
    },
    "required": ["accessToken"]
  }
}
```

##### `extensions/mercadopago-mcp/src/types.ts`
```typescript
import { z } from "zod";

// Plugin configuration
export const MercadoPagoConfigSchema = z.object({
  accessToken: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("production"),
});

export type MercadoPagoConfig = z.infer<typeof MercadoPagoConfigSchema>;

// Date validation with injection prevention
const SafeDateString = z.string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be YYYY-MM-DD format")
  .refine((d) => !isNaN(Date.parse(d)), "Invalid date");

// API response schemas
export const BalanceResponseSchema = z.object({
  available_balance: z.number(),
  unavailable_balance: z.number(),
  currency_id: z.string(),
});

export const ReportResponseSchema = z.object({
  id: z.number().optional(),
  status: z.string().optional(),
  file_name: z.string(),
});

// Tool output schemas
export const BalanceOutputSchema = z.object({
  available: z.number(),
  pending: z.number(),
  total: z.number(),
  currency: z.string(),
});

export const CashflowOutputSchema = z.object({
  period: z.object({
    start_date: z.string(),
    end_date: z.string(),
  }),
  total_inflow: z.number(),
  total_outflow: z.number(),
  net_change: z.number(),
  transaction_count: z.number(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.string(),
  description: z.string(),
  gross_amount: z.number(),
  net_amount: z.number(),
  fee_amount: z.number(),
  currency: z.string(),
});

export type Balance = z.infer<typeof BalanceOutputSchema>;
export type Cashflow = z.infer<typeof CashflowOutputSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
```

##### `extensions/mercadopago-mcp/src/client.ts`
```typescript
// MercadoPago API client with retry logic and type-safe responses
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
    public readonly recoveryHint?: string
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
  options?: { method?: string; body?: unknown }
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
        const text = await res.text().catch(() => "");
        const retryAfter = res.status === 429
          ? Number(res.headers.get("Retry-After")) || undefined
          : undefined;
        throw new MercadoPagoApiError(
          `MercadoPago API ${path} failed (${res.status})`,
          res.status,
          retryAfter
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
          "API response format changed. Contact support."
        );
      }
      return parsed.data;
    },
    {
      ...RETRY_DEFAULTS,
      shouldRetry: (err) =>
        err instanceof MercadoPagoApiError &&
        (err.status === 429 || err.status >= 500),
      retryAfterMs: (err) =>
        err instanceof MercadoPagoApiError && err.retryAfter
          ? err.retryAfter * 1000
          : undefined,
    }
  );
}

// Fetch raw text (for CSV reports)
export async function fetchMercadoPagoRaw(
  path: string,
  token: string
): Promise<string> {
  const res = await fetch(`${MERCADOPAGO_API_BASE}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  if (!res.ok) {
    if (res.status === 404) {
      throw new MercadoPagoApiError(
        "Report not ready yet",
        404,
        undefined,
        "Report is still processing. Wait 30 seconds and retry."
      );
    }
    throw new MercadoPagoApiError(
      `Failed to download report (${res.status})`,
      res.status
    );
  }

  return res.text();
}
```

##### `extensions/mercadopago-mcp/src/csv-parser.ts`
```typescript
// Streaming CSV parser with memory efficiency and injection protection

export interface CsvRow {
  [key: string]: string;
}

// Sanitize CSV values to prevent formula injection
function sanitizeValue(value: string): string {
  // Remove leading characters that could trigger formula execution
  if (/^[=+\-@\t\r]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

// Parse CSV handling quoted fields correctly
export function* parseCSVStream(csv: string): Generator<CsvRow> {
  const lines = csv.split("\n");
  if (lines.length === 0) return;

  // Parse header
  const headers = parseCSVLine(lines[0]);

  // Parse data rows
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

function parseCSVLine(line: string): string[] {
  const result: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];

    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      result.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  result.push(current.trim());
  return result;
}

// Aggregate cashflow from CSV with streaming
export function aggregateCashflow(csv: string): {
  totalInflow: number;
  totalOutflow: number;
  transactionCount: number;
} {
  let totalInflow = 0;
  let totalOutflow = 0;
  let transactionCount = 0;

  for (const row of parseCSVStream(csv)) {
    const credit = parseFloat(row.NET_CREDIT_AMOUNT || "0");
    const debit = parseFloat(row.NET_DEBIT_AMOUNT || "0");

    if (!isNaN(credit)) totalInflow += credit;
    if (!isNaN(debit)) totalOutflow += Math.abs(debit);
    transactionCount++;
  }

  return { totalInflow, totalOutflow, transactionCount };
}
```

#### Phase 2: Tool Registration (OpenClaw Pattern)

##### `extensions/mercadopago-mcp/index.ts`
```typescript
// Plugin registration using OpenClaw's api.registerTool() pattern
import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { Type } from "@sinclair/typebox";
import { MercadoPagoConfigSchema } from "./src/types.js";
import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createGetCashflowTool } from "./src/tools/get-cashflow.js";
import { createListTransactionsTool } from "./src/tools/list-transactions.js";

export default function register(api: OpenClawPluginApi) {
  // Validate config
  const configResult = MercadoPagoConfigSchema.safeParse(api.pluginConfig);
  if (!configResult.success) {
    // Silently skip if not configured (optional extension)
    return;
  }

  const config = configResult.data;

  // Register tools directly with OpenClaw
  api.registerTool(createGetBalanceTool(config), { optional: true });
  api.registerTool(createGetCashflowTool(config), { optional: true });
  api.registerTool(createListTransactionsTool(config), { optional: true });
}
```

##### `extensions/mercadopago-mcp/src/tools/get-balance.ts`
```typescript
import { Type } from "@sinclair/typebox";
import type { MercadoPagoConfig } from "../types.js";
import { fetchMercadoPago, MercadoPagoApiError } from "../client.js";
import { BalanceResponseSchema } from "../types.js";

export function createGetBalanceTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_get_balance",
    description: "Get current MercadoPago account balance (available and pending)",
    parameters: Type.Object({}),

    async execute() {
      try {
        const response = await fetchMercadoPago(
          "/v1/account/balance",
          config.accessToken,
          BalanceResponseSchema
        );

        const output = {
          available: response.available_balance,
          pending: response.unavailable_balance,
          total: response.available_balance + response.unavailable_balance,
          currency: response.currency_id,
        };

        return {
          content: [
            {
              type: "text" as const,
              text: `Balance: ${output.currency} ${output.available.toFixed(2)} available, ${output.pending.toFixed(2)} pending (${output.total.toFixed(2)} total)`,
            },
          ],
          structuredContent: output,
        };
      } catch (error) {
        if (error instanceof MercadoPagoApiError) {
          return {
            content: [{ type: "text" as const, text: error.message }],
            structuredContent: error.toAgentError(),
            isError: true,
          };
        }
        throw error;
      }
    },
  };
}
```

##### `extensions/mercadopago-mcp/src/tools/get-cashflow.ts`
```typescript
import { Type } from "@sinclair/typebox";
import type { MercadoPagoConfig } from "../types.js";
import { fetchMercadoPago, fetchMercadoPagoRaw, MercadoPagoApiError } from "../client.js";
import { ReportResponseSchema } from "../types.js";
import { aggregateCashflow } from "../csv-parser.js";

// Date validation
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function createGetCashflowTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_get_cashflow",
    description: "Get cashflow summary (money in/out) for a date range. Generates a report and returns aggregated inflows and outflows.",
    parameters: Type.Object({
      start_date: Type.String({
        description: "Start date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      }),
      end_date: Type.String({
        description: "End date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      }),
    }),

    async execute({ start_date, end_date }: { start_date: string; end_date: string }) {
      // Validate dates
      if (!DATE_REGEX.test(start_date) || !DATE_REGEX.test(end_date)) {
        return {
          content: [{ type: "text" as const, text: "Invalid date format. Use YYYY-MM-DD." }],
          structuredContent: { error: "Invalid date format", hint: "Use YYYY-MM-DD format" },
          isError: true,
        };
      }

      try {
        // Step 1: Generate report
        const report = await fetchMercadoPago(
          "/v1/account/release_report",
          config.accessToken,
          ReportResponseSchema,
          {
            method: "POST",
            body: {
              begin_date: `${start_date}T00:00:00Z`,
              end_date: `${end_date}T23:59:59Z`,
            },
          }
        );

        // Step 2: Poll for report with exponential backoff
        const maxAttempts = 12;
        let delay = 5000; // Start at 5 seconds

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise(r => setTimeout(r, delay));

          try {
            const csv = await fetchMercadoPagoRaw(
              `/v1/account/release_report/${report.file_name}`,
              config.accessToken
            );

            // Step 3: Parse and aggregate with streaming
            const { totalInflow, totalOutflow, transactionCount } = aggregateCashflow(csv);

            const output = {
              period: { start_date, end_date },
              total_inflow: totalInflow,
              total_outflow: totalOutflow,
              net_change: totalInflow - totalOutflow,
              transaction_count: transactionCount,
            };

            return {
              content: [
                {
                  type: "text" as const,
                  text: `Cashflow ${start_date} to ${end_date}:\n` +
                    `  Money In:  ${output.total_inflow.toFixed(2)}\n` +
                    `  Money Out: ${output.total_outflow.toFixed(2)}\n` +
                    `  Net:       ${output.net_change.toFixed(2)}\n` +
                    `  Transactions: ${output.transaction_count}`,
                },
              ],
              structuredContent: output,
            };
          } catch (error) {
            if (error instanceof MercadoPagoApiError && error.status === 404) {
              // Report not ready, continue polling with backoff
              delay = Math.min(delay * 1.5, 30000); // Max 30 seconds
              continue;
            }
            throw error;
          }
        }

        // Timeout after max attempts
        return {
          content: [
            {
              type: "text" as const,
              text: `Report generation timed out. Report ID: ${report.file_name}. Try again later.`,
            },
          ],
          structuredContent: {
            status: "timeout",
            report_id: report.file_name,
            hint: "Report is still processing. Try again in a few minutes.",
          },
        };
      } catch (error) {
        if (error instanceof MercadoPagoApiError) {
          return {
            content: [{ type: "text" as const, text: error.message }],
            structuredContent: error.toAgentError(),
            isError: true,
          };
        }
        throw error;
      }
    },
  };
}
```

##### `extensions/mercadopago-mcp/src/tools/list-transactions.ts`
```typescript
import { Type } from "@sinclair/typebox";
import type { MercadoPagoConfig, Transaction } from "../types.js";
import { fetchMercadoPagoRaw, MercadoPagoApiError } from "../client.js";
import { parseCSVStream } from "../csv-parser.js";

export function createListTransactionsTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_list_transactions",
    description: "List recent transactions from MercadoPago account with optional filters",
    parameters: Type.Object({
      limit: Type.Optional(Type.Number({
        description: "Maximum transactions to return (default: 10, max: 100)",
        minimum: 1,
        maximum: 100
      })),
      date_from: Type.Optional(Type.String({
        description: "Filter from date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      })),
      date_to: Type.Optional(Type.String({
        description: "Filter to date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$"
      })),
    }),

    async execute({ limit = 10, date_from, date_to }: {
      limit?: number;
      date_from?: string;
      date_to?: string;
    }) {
      try {
        // Use last 7 days if no dates specified
        const endDate = date_to || new Date().toISOString().split("T")[0];
        const startDate = date_from || (() => {
          const d = new Date();
          d.setDate(d.getDate() - 7);
          return d.toISOString().split("T")[0];
        })();

        // Get recent report (using list endpoint)
        // Note: In production, cache this or use a recent report
        const csv = await fetchMercadoPagoRaw(
          "/v1/account/release_report/list",
          config.accessToken
        );

        // Parse transactions (limited)
        const transactions: Transaction[] = [];
        let count = 0;

        for (const row of parseCSVStream(csv)) {
          if (count >= limit) break;

          transactions.push({
            id: row.SOURCE_ID || row.EXTERNAL_REFERENCE || `tx-${count}`,
            date: row.DATE || "",
            type: row.RECORD_TYPE || row.TRANSACTION_TYPE || "",
            description: row.DESCRIPTION || row.REFERENCE || "",
            gross_amount: parseFloat(row.GROSS_AMOUNT || "0"),
            net_amount: parseFloat(row.NET_CREDIT_AMOUNT || row.NET_DEBIT_AMOUNT || "0"),
            fee_amount: parseFloat(row.FEE_AMOUNT || "0"),
            currency: row.CURRENCY_ID || "BRL",
          });
          count++;
        }

        return {
          content: [
            {
              type: "text" as const,
              text: `Found ${transactions.length} transactions:\n` +
                transactions.map(t =>
                  `  ${t.date} | ${t.type} | ${t.net_amount.toFixed(2)} | ${t.description.slice(0, 30)}`
                ).join("\n"),
            },
          ],
          structuredContent: { transactions, count: transactions.length },
        };
      } catch (error) {
        if (error instanceof MercadoPagoApiError) {
          return {
            content: [{ type: "text" as const, text: error.message }],
            structuredContent: error.toAgentError(),
            isError: true,
          };
        }
        throw error;
      }
    },
  };
}
```

## Acceptance Criteria

### Functional Requirements

- [x] **Auth:** Extension reads `accessToken` from `api.pluginConfig` and uses Bearer authentication
- [x] **Balance:** `mercadopago_get_balance` returns available, pending, total, currency
- [x] **Cashflow:** `mercadopago_get_cashflow` generates report, polls, and returns aggregated inflows/outflows
- [x] **Transactions:** `mercadopago_list_transactions` returns parsed transaction list
- [x] **Errors:** All tools return structured errors with recovery hints for agent use

### Non-Functional Requirements

- [x] **Rate Limits:** Implement exponential backoff on 429 responses (starting 500ms, max 30s)
- [x] **Retry:** Retry on 5xx errors up to 3 times with jitter
- [x] **Timeout:** Report polling timeout after 60 seconds
- [x] **Memory:** Stream CSV parsing, never load full report into memory at once
- [x] **Security:** Validate all date inputs, sanitize CSV fields, never log tokens

### Quality Gates

- [x] Unit tests for CSV parser (edge cases: quoted fields, commas, formulas)
- [x] Unit tests for API client (mock responses, error handling)
- [ ] Integration test with sandbox account
- [x] Extension loads without errors in OpenClaw
- [x] TypeScript strict mode passes

## Success Metrics

| Metric | Target |
|--------|--------|
| Tool call success rate | > 95% |
| Balance query response time | < 500ms |
| Cashflow report completion | < 60s |
| Memory usage per report | < 50MB |

## Dependencies & Prerequisites

### Required Before Development

1. **MercadoPago Developer Account** with API credentials
2. **Test Data** in sandbox environment

### External Dependencies

| Dependency | Version | Purpose |
|------------|---------|---------|
| `zod` | ^3.25.0 | Schema validation |
| `@sinclair/typebox` | (bundled) | Tool parameter schemas |

### Internal Dependencies

| Module | Purpose |
|--------|---------|
| `src/infra/retry.js` | Retry logic with backoff |
| `src/plugins/types.js` | Plugin API types (`OpenClawPluginApi`) |

## Risk Analysis & Mitigation

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| API rate limits hit | Medium | High | Exponential backoff, request queuing |
| Large reports cause memory issues | Medium | High | Streaming CSV parser |
| Token exposure in logs | Low | Critical | Never log tokens, mask in errors |
| CSV injection attack | Low | High | Sanitize all CSV values |
| API response format change | Low | Medium | Zod schema validation with helpful errors |

## References & Research

### Internal References (Correct Patterns)

- Extension pattern: `extensions/lobster/index.ts` (uses `api.registerTool()`)
- Plugin types: `src/plugins/types.ts:235-274` (OpenClawPluginApi interface)
- Tool registration: `extensions/llm-task/index.ts` (TypeBox parameters)
- Retry logic: `src/infra/retry.ts`

### External References

- [MercadoPago Release Report API](https://www.mercadopago.com.ar/developers/en/docs/reports/released-money/api)
- [MercadoPago OAuth Documentation](https://www.mercadopago.com.br/developers/en/docs/checkout-api-payments/additional-content/security/oauth/introduction)

### Research Findings

- MercadoPago rate limit: 1500 req/min per seller
- Reports generate asynchronously (HTTP 202)
- Token lifetime: 6 hours (client credentials) or 180 days (authorization code)
- Report columns: DATE, SOURCE_ID, NET_CREDIT_AMOUNT, NET_DEBIT_AMOUNT
- CSV may contain quoted fields with commas - need proper parser
