import { Type } from "@sinclair/typebox";
import { z } from "zod";

import { fetchMercadoPago, MercadoPagoApiError } from "../client.js";
import type { MercadoPagoConfig, Transaction } from "../types.js";

// Schema for payments search API response
const PaymentsSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      date_created: z.string(),
      date_approved: z.string().nullable(),
      operation_type: z.string(),
      description: z.string().nullable(),
      transaction_amount: z.number(),
      currency_id: z.string(),
      status: z.string(),
      status_detail: z.string().nullable(),
      fee_details: z.array(z.object({ amount: z.number() })).optional(),
      payer: z.object({
        email: z.string().nullable().optional(),
        id: z.string().nullable().optional(),
      }).optional(),
    }),
  ),
  paging: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export function createListTransactionsTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_list_transactions",
    description: "List recent transactions from MercadoPago account with optional filters",
    parameters: Type.Object({
      limit: Type.Optional(
        Type.Number({
          description: "Maximum transactions to return (default: 10, max: 100)",
          minimum: 1,
          maximum: 100,
        }),
      ),
      date_from: Type.Optional(
        Type.String({
          description: "Filter from date (YYYY-MM-DD)",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        }),
      ),
      date_to: Type.Optional(
        Type.String({
          description: "Filter to date (YYYY-MM-DD)",
          pattern: "^\\d{4}-\\d{2}-\\d{2}$",
        }),
      ),
      status: Type.Optional(
        Type.String({
          description: "Filter by status (approved, pending, rejected, etc.)",
        }),
      ),
    }),

    async execute(
      _id: string,
      params: {
        limit?: number;
        date_from?: string;
        date_to?: string;
        status?: string;
      },
    ) {
      const { limit = 10, date_from, date_to, status } = params;

      try {
        // Build query params for payments search
        const queryParams = new URLSearchParams();
        queryParams.set("limit", String(Math.min(limit, 100)));
        queryParams.set("sort", "date_created");
        queryParams.set("criteria", "desc");

        // Date range (default to last 7 days if not specified)
        const endDate = date_to || new Date().toISOString().split("T")[0];
        const startDate =
          date_from ||
          (() => {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            return d.toISOString().split("T")[0];
          })();

        queryParams.set("range", "date_created");
        queryParams.set("begin_date", `${startDate}T00:00:00Z`);
        queryParams.set("end_date", `${endDate}T23:59:59Z`);

        if (status) {
          queryParams.set("status", status);
        }

        // Use payments search API - more reliable than reports
        const response = await fetchMercadoPago(
          `/v1/payments/search?${queryParams.toString()}`,
          config.accessToken,
          PaymentsSearchResponseSchema,
        );

        // Convert to Transaction format
        const transactions: Transaction[] = response.results.map((payment) => {
          const feeAmount = payment.fee_details?.reduce((sum, f) => sum + f.amount, 0) ?? 0;
          return {
            id: String(payment.id),
            date: payment.date_approved || payment.date_created,
            type: payment.operation_type,
            description: payment.description || payment.status_detail || payment.status,
            gross_amount: payment.transaction_amount,
            net_amount: payment.transaction_amount - feeAmount,
            fee_amount: feeAmount,
            currency: payment.currency_id,
          };
        });

        const totalAvailable = response.paging.total;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${transactions.length} transactions (${totalAvailable} total in period):\n` +
                transactions
                  .map(
                    (t) =>
                      `  ${t.date.split("T")[0]} | ${t.type} | ${t.currency} ${t.gross_amount.toFixed(2)} | ${(t.description ?? "").slice(0, 30)}`,
                  )
                  .join("\n"),
            },
          ],
          structuredContent: {
            transactions,
            count: transactions.length,
            total_available: totalAvailable,
            period: { start_date: startDate, end_date: endDate },
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
