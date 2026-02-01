import { Type } from "@sinclair/typebox";

import { fetchMercadoPago, fetchMercadoPagoRaw, MercadoPagoApiError } from "../client.js";
import { aggregateCashflow } from "../csv-parser.js";
import { ReportResponseSchema, type MercadoPagoConfig } from "../types.js";

// Date validation
const DATE_REGEX = /^\d{4}-\d{2}-\d{2}$/;

export function createGetCashflowTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_get_cashflow",
    description:
      "Get cashflow summary (money in/out) for a date range. Generates a report and returns aggregated inflows and outflows.",
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
          },
        );

        // Step 2: Poll for report with exponential backoff
        const maxAttempts = 12;
        let delay = 5000; // Start at 5 seconds

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, delay));

          try {
            const csv = await fetchMercadoPagoRaw(
              `/v1/account/release_report/${report.file_name}`,
              config.accessToken,
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
                  text:
                    `Cashflow ${start_date} to ${end_date}:\n` +
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
