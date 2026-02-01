import { Type } from "@sinclair/typebox";

import { fetchMercadoPago, fetchMercadoPagoRaw, MercadoPagoApiError } from "../client.js";
import { parseCSVStream } from "../csv-parser.js";
import { ReportResponseSchema, type MercadoPagoConfig, type Transaction } from "../types.js";

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
    }),

    async execute(
      _id: string,
      params: {
        limit?: number;
        date_from?: string;
        date_to?: string;
      },
    ) {
      const { limit = 10, date_from, date_to } = params;

      try {
        // Use last 7 days if no dates specified
        const endDate = date_to || new Date().toISOString().split("T")[0];
        const startDate =
          date_from ||
          (() => {
            const d = new Date();
            d.setDate(d.getDate() - 7);
            return d.toISOString().split("T")[0];
          })();

        // Generate a report for the date range
        const report = await fetchMercadoPago(
          "/v1/account/release_report",
          config.accessToken,
          ReportResponseSchema,
          {
            method: "POST",
            body: {
              begin_date: `${startDate}T00:00:00Z`,
              end_date: `${endDate}T23:59:59Z`,
            },
          },
        );

        // Poll for report with exponential backoff
        const maxAttempts = 12;
        let delay = 5000;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
          await new Promise((r) => setTimeout(r, delay));

          try {
            const csv = await fetchMercadoPagoRaw(
              `/v1/account/release_report/${report.file_name}`,
              config.accessToken,
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
                  text:
                    `Found ${transactions.length} transactions:\n` +
                    transactions
                      .map(
                        (t) =>
                          `  ${t.date} | ${t.type} | ${t.net_amount.toFixed(2)} | ${t.description.slice(0, 30)}`,
                      )
                      .join("\n"),
                },
              ],
              structuredContent: { transactions, count: transactions.length },
            };
          } catch (error) {
            if (error instanceof MercadoPagoApiError && error.status === 404) {
              delay = Math.min(delay * 1.5, 30000);
              continue;
            }
            throw error;
          }
        }

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
