import { Type } from "@sinclair/typebox";
import { z } from "zod";

import type { OpenClawPluginApi } from "../../src/plugins/types.js";
import { loginBtgDeviceCode, refreshBtgOAuth, type BtgOAuthToken } from "./oauth.js";

const BTG_API_BASE = "https://api-business.btgpactual.com/v1";
const PROVIDER_ID = "btg-pactual";

// Zod schemas for runtime API response validation
const BtgAccountSchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.string(),
  branch: z.string(),
  number: z.string(),
});

const BtgAccountsResponseSchema = z.object({
  accounts: z.array(BtgAccountSchema),
});

const BtgBalanceSchema = z.object({
  account_id: z.string(),
  available_balance: z.number(),
  total_balance: z.number(),
  currency: z.string(),
  as_of: z.string(),
});

const BtgTransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  amount: z.number(),
  currency: z.string(),
  type: z.string(),
  description: z.string(),
});

const BtgTransactionsResponseSchema = z.object({
  transactions: z.array(BtgTransactionSchema),
  next_cursor: z.string().optional(),
  has_more: z.boolean(),
});

// Token manager with refresh deduplication
let tokenState: BtgOAuthToken | null = null;
let refreshPromise: Promise<string> | null = null;
const REFRESH_BUFFER_MS = 15 * 60 * 1000; // 15 minutes before expiry

function getClientId(): string {
  const clientId = process.env.BTG_CLIENT_ID;
  if (!clientId) {
    throw new Error("BTG_CLIENT_ID environment variable is required");
  }
  return clientId;
}

async function getToken(api: OpenClawPluginApi): Promise<string> {
  if (tokenState && Date.now() < tokenState.expires - REFRESH_BUFFER_MS) {
    return tokenState.access;
  }

  if (!tokenState?.refresh) {
    throw new Error(
      "BTG Pactual not authenticated. Run: openclaw models auth login --provider btg-pactual",
    );
  }

  // Deduplicate concurrent refresh requests
  if (!refreshPromise) {
    refreshPromise = (async () => {
      try {
        const newToken = await refreshBtgOAuth(tokenState!, getClientId());
        tokenState = newToken;
        api.logger.info("btg-pactual: token refreshed successfully");
        return newToken.access;
      } catch (err) {
        tokenState = null;
        throw err;
      } finally {
        refreshPromise = null;
      }
    })();
  }

  return refreshPromise;
}

// Validated fetch with timeout and error handling
async function btgFetch<T>(
  endpoint: string,
  token: string,
  schema: z.ZodType<T>,
  api: OpenClawPluginApi,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const requestId = crypto.randomUUID();
    const res = await fetch(`${BTG_API_BASE}${endpoint}`, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: "application/json",
        "x-request-id": requestId,
      },
      signal: controller.signal,
    });

    if (!res.ok) {
      const text = await res.text();
      api.logger.error(`btg-pactual: API error ${res.status} on ${endpoint}`);

      if (res.status === 401) {
        tokenState = null;
        throw new Error(
          "Authentication failed. Please reconnect: openclaw models auth login --provider btg-pactual",
        );
      }

      if (res.status === 429) {
        throw new Error("Rate limited by BTG API. Please wait and try again.");
      }

      throw new Error(`BTG API error (${res.status}): ${text.slice(0, 200)}`);
    }

    const json: unknown = await res.json();
    return schema.parse(json);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("BTG API request timed out after 15 seconds");
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export default function register(api: OpenClawPluginApi): void {
  // Register OAuth provider for `openclaw models auth login --provider btg-pactual`
  api.registerProvider({
    id: PROVIDER_ID,
    label: "BTG Pactual",
    envVars: ["BTG_CLIENT_ID"],
    auth: [
      {
        id: "device",
        label: "Device Code (VPS compatible)",
        hint: "Authenticate via browser - works on VPS/headless servers",
        kind: "device_code",
        run: async (ctx) => {
          const clientId = getClientId();
          const progress = ctx.prompter.progress("Starting BTG Pactual OAuth...");

          try {
            const token = await loginBtgDeviceCode({
              clientId,
              openUrl: ctx.openUrl,
              note: ctx.prompter.note,
              progress: {
                update: (msg: string) => progress.update(msg),
                stop: (msg?: string) => progress.stop(msg),
              },
            });
            tokenState = token;

            progress.stop("BTG Pactual OAuth complete");

            return {
              profiles: [
                {
                  profileId: `${PROVIDER_ID}:default`,
                  credential: {
                    type: "oauth" as const,
                    provider: PROVIDER_ID,
                    access: token.access,
                    refresh: token.refresh,
                    expires: token.expires,
                  },
                },
              ],
            };
          } catch (err) {
            progress.stop("BTG Pactual OAuth failed");
            throw err;
          }
        },
      },
    ],
  });

  // Tool: btg_list_accounts
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) return null;
      return {
        name: "btg_list_accounts",
        description:
          "List all BTG Pactual business accounts accessible to the user. " +
          "Call this FIRST to get valid account_id values needed by btg_get_balance and btg_list_transactions. " +
          "Returns account IDs, names, types, branch and account numbers. Read-only operation.",
        parameters: Type.Object({}),
        async execute(_toolCallId: string, _params: Record<string, unknown>) {
          try {
            const token = await getToken(api);
            const data = await btgFetch("/accounts", token, BtgAccountsResponseSchema, api);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(data.accounts, null, 2) }],
              details: data.accounts,
            };
          } catch (err) {
            api.logger.error(`btg_list_accounts error: ${err instanceof Error ? err.message : err}`);
            return {
              content: [
                { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
              ],
              details: { error: err instanceof Error ? err.message : String(err) },
              isError: true,
            };
          }
        },
      };
    },
    { optional: true },
  );

  // Tool: btg_get_balance
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) return null;
      return {
        name: "btg_get_balance",
        description:
          "Get the current balance for a BTG Pactual account. " +
          "Requires account_id from btg_list_accounts. Returns available and total balance with currency. " +
          "If user asks 'my balance' without specifying, call btg_list_accounts first to get account IDs.",
        parameters: Type.Object({
          account_id: Type.String({ description: "Account ID from btg_list_accounts" }),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const account_id = params.account_id as string;
            const token = await getToken(api);
            const balance = await btgFetch(`/balances/${account_id}`, token, BtgBalanceSchema, api);
            return {
              content: [{ type: "text" as const, text: JSON.stringify(balance, null, 2) }],
              details: balance,
            };
          } catch (err) {
            api.logger.error(`btg_get_balance error: ${err instanceof Error ? err.message : err}`);
            return {
              content: [
                { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
              ],
              details: { error: err instanceof Error ? err.message : String(err) },
              isError: true,
            };
          }
        },
      };
    },
    { optional: true },
  );

  // Tool: btg_list_transactions
  api.registerTool(
    (ctx) => {
      if (ctx.sandboxed) return null;
      return {
        name: "btg_list_transactions",
        description:
          "List transactions for a BTG Pactual account. Supports date filtering and pagination. " +
          "If start_date is omitted, defaults to 30 days ago. " +
          "To fetch more results, use the cursor from the response. " +
          "Returns transaction ID, date, amount, currency, type, and description.",
        parameters: Type.Object({
          account_id: Type.String({ description: "Account ID from btg_list_accounts" }),
          start_date: Type.Optional(
            Type.String({
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description: "Start date in YYYY-MM-DD format. Defaults to 30 days ago.",
            }),
          ),
          end_date: Type.Optional(
            Type.String({
              pattern: "^\\d{4}-\\d{2}-\\d{2}$",
              description: "End date in YYYY-MM-DD format. Defaults to today.",
            }),
          ),
          limit: Type.Optional(
            Type.Integer({
              minimum: 1,
              maximum: 100,
              description: "Max transactions to return (default: 50, max: 100)",
            }),
          ),
          cursor: Type.Optional(
            Type.String({
              description: "Pagination cursor from previous response to fetch next page",
            }),
          ),
        }),
        async execute(_toolCallId: string, params: Record<string, unknown>) {
          try {
            const account_id = params.account_id as string;
            const start_date = params.start_date as string | undefined;
            const end_date = params.end_date as string | undefined;
            const limit = params.limit as number | undefined;
            const cursor = params.cursor as string | undefined;
            const token = await getToken(api);

            const qs = new URLSearchParams();
            if (start_date) qs.set("start_date", start_date);
            if (end_date) qs.set("end_date", end_date);
            if (limit) qs.set("limit", String(limit));
            if (cursor) qs.set("cursor", cursor);

            const queryString = qs.toString();
            const endpoint = `/accounts/${account_id}/transactions${queryString ? `?${queryString}` : ""}`;

            const result = await btgFetch(endpoint, token, BtgTransactionsResponseSchema, api);

            // Add pagination hint for agent
            const output = {
              ...result,
              _hint: result.has_more
                ? `More transactions available. Call btg_list_transactions with cursor="${result.next_cursor}" to fetch next page.`
                : "All transactions returned.",
            };

            return {
              content: [{ type: "text" as const, text: JSON.stringify(output, null, 2) }],
              details: output,
            };
          } catch (err) {
            api.logger.error(`btg_list_transactions error: ${err instanceof Error ? err.message : err}`);
            return {
              content: [
                { type: "text" as const, text: `Error: ${err instanceof Error ? err.message : err}` },
              ],
              details: { error: err instanceof Error ? err.message : String(err) },
              isError: true,
            };
          }
        },
      };
    },
    { optional: true },
  );

  api.logger.info("btg-pactual: plugin registered with 3 read-only banking tools");
}
