import { Type } from "@sinclair/typebox";
import { z } from "zod";

import { fetchMercadoPago, MercadoPagoApiError } from "../client.js";
import type { MercadoPagoConfig } from "../types.js";

// Date validation
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

// Schema for payments search API response
const PaymentsSearchResponseSchema = z.object({
  results: z.array(
    z.object({
      id: z.number(),
      date_approved: z.string().nullable(),
      date_created: z.string(),
      operation_type: z.string(),
      transaction_amount: z.number(),
      currency_id: z.string(),
      status: z.string(),
      fee_details: z.array(z.object({ amount: z.number() })).optional(),
    }),
  ),
  paging: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

export function createGetCashflowTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_get_cashflow",
    description:
      "Get cashflow summary (money in/out) for a date range. Aggregates payments to show total inflows and outflows.",
    parameters: Type.Object({
      start_date: Type.String({
        description: "Start date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      }),
      end_date: Type.String({
        description: "End date (YYYY-MM-DD)",
        pattern: "^\\d{4}-\\d{2}-\\d{2}$",
      }),
    }),

    async execute(
      _id: string,
      params: { start_date: string; end_date: string },
    ) {
      const { start_date, end_date } = params;

      // Validate dates
      if (!DATE_REGEX.test(start_date) || !DATE_REGEX.test(end_date)) {
        return {
          content: [{ type: "text" as const, text: "Invalid date format. Use YYYY-MM-DD." }],
          structuredContent: { error: "Invalid date format", hint: "Use YYYY-MM-DD format" },
          isError: true,
        };
      }

      try {
        // Fetch all approved payments in the period using pagination
        let totalInflow = 0;
        let totalOutflow = 0;
        let totalFees = 0;
        let transactionCount = 0;
        let offset = 0;
        const limit = 100;
        let currency = "BRL";

        // Paginate through all results
        while (true) {
          const queryParams = new URLSearchParams({
            status: "approved",
            limit: String(limit),
            offset: String(offset),
            sort: "date_created",
            criteria: "desc",
            range: "date_created",
            begin_date: `${start_date}T00:00:00Z`,
            end_date: `${end_date}T23:59:59Z`,
          });

          const response = await fetchMercadoPago(
            `/v1/payments/search?${queryParams.toString()}`,
            config.accessToken,
            PaymentsSearchResponseSchema,
          );

          for (const payment of response.results) {
            currency = payment.currency_id;
            const fees = payment.fee_details?.reduce((sum, f) => sum + f.amount, 0) ?? 0;
            totalFees += fees;

            // Inflows: payments received (positive amounts)
            // Outflows: refunds (negative amounts) or operation_type indicates refund
            if (payment.transaction_amount >= 0 && payment.operation_type !== "refund") {
              totalInflow += payment.transaction_amount;
            } else {
              totalOutflow += Math.abs(payment.transaction_amount);
            }
            transactionCount++;
          }

          // Check if we've fetched all results
          if (response.results.length < limit || offset + limit >= response.paging.total) {
            break;
          }
          offset += limit;

          // Safety limit: max 10 pages (1000 transactions)
          if (offset >= 1000) {
            break;
          }
        }

        const output = {
          period: { start_date, end_date },
          total_inflow: totalInflow,
          total_outflow: totalOutflow,
          total_fees: totalFees,
          net_change: totalInflow - totalOutflow - totalFees,
          gross_net_change: totalInflow - totalOutflow,
          transaction_count: transactionCount,
          currency,
        };

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Cashflow ${start_date} to ${end_date} (${currency}):\n` +
                `  Money In:     ${output.total_inflow.toFixed(2)}\n` +
                `  Money Out:    ${output.total_outflow.toFixed(2)}\n` +
                `  Fees:         ${output.total_fees.toFixed(2)}\n` +
                `  Net (gross):  ${output.gross_net_change.toFixed(2)}\n` +
                `  Net (after fees): ${output.net_change.toFixed(2)}\n` +
                `  Transactions: ${output.transaction_count}`,
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
