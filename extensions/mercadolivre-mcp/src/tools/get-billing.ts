import { Type } from "@sinclair/typebox";
import { z } from "zod";

import { fetchMercadoLivre, MercadoLivreApiError } from "../client.js";

// Billing periods response schema
const BillingPeriodsResponseSchema = z.object({
  periods: z.array(
    z.object({
      key: z.string(),
      group: z.string(),
      year: z.number(),
      month: z.number(),
      status: z.string(),
      total: z.number().optional(),
      currency_id: z.string().optional(),
    }),
  ),
});

// Billing details response schema
const BillingDetailsResponseSchema = z.object({
  results: z.array(
    z.object({
      detail_id: z.string().optional(),
      type: z.string(),
      description: z.string().optional(),
      amount: z.number(),
      currency_id: z.string(),
      date: z.string().optional(),
      reference_id: z.string().optional(),
    }),
  ),
  paging: z
    .object({
      total: z.number(),
      limit: z.number(),
      offset: z.number(),
    })
    .optional(),
});

export function createGetBillingTool(getToken: () => Promise<string>, getUserId: () => number | null) {
  return {
    name: "mercadolivre_get_billing",
    description:
      "Get billing periods and details from Mercado Livre for financial reporting. " +
      "READ-ONLY operation - does not modify any data. " +
      "Use for DRE (income statement) and Balanco Patrimonial calculations. " +
      "Without period_key, lists available billing periods. With period_key, shows detailed breakdown.",
    parameters: Type.Object({
      period_key: Type.Optional(
        Type.String({
          description: "Billing period key to get details for (from periods list)",
        }),
      ),
      group: Type.Optional(
        Type.String({
          description: "Billing group: ML (Mercado Livre) or MP (Mercado Pago). Default: ML",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum periods/details to return (default: 12)",
          minimum: 1,
          maximum: 50,
        }),
      ),
    }),

    async execute(
      _id: string,
      params: {
        period_key?: string;
        group?: string;
        limit?: number;
      },
    ) {
      const { period_key, group = "ML", limit = 12 } = params;

      try {
        const token = await getToken();
        const userId = getUserId();

        if (!userId) {
          throw new MercadoLivreApiError(
            "User ID not available",
            400,
            undefined,
            "Call mercadolivre_get_user_info first to get seller context.",
          );
        }

        // If period_key provided, get details for that period
        if (period_key) {
          const queryParams = new URLSearchParams();
          queryParams.set("limit", String(limit));

          const detailsResponse = await fetchMercadoLivre(
            `/billing/integration/periods/key/${period_key}/group/${group}/details?${queryParams.toString()}`,
            token,
            BillingDetailsResponseSchema,
          );

          const details = detailsResponse.results;

          // Group by type for summary
          const byType = new Map<string, { count: number; total: number }>();
          let totalAmount = 0;
          let currency = "BRL";

          for (const detail of details) {
            currency = detail.currency_id;
            totalAmount += detail.amount;

            const existing = byType.get(detail.type) || { count: 0, total: 0 };
            byType.set(detail.type, {
              count: existing.count + 1,
              total: existing.total + detail.amount,
            });
          }

          const typeSummary = Array.from(byType.entries())
            .sort((a, b) => Math.abs(b[1].total) - Math.abs(a[1].total))
            .map(([type, data]) => `  ${type}: ${currency} ${data.total.toFixed(2)} (${data.count} items)`)
            .join("\n");

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Billing Details for Period: ${period_key}\n` +
                  `Group: ${group}\n` +
                  `Total Entries: ${details.length}\n\n` +
                  `Summary by Type:\n${typeSummary}\n\n` +
                  `Net Total: ${currency} ${totalAmount.toFixed(2)}`,
              },
            ],
            structuredContent: {
              period_key,
              group,
              details,
              summary: {
                by_type: Object.fromEntries(byType),
                total: totalAmount,
                currency,
                detail_count: details.length,
              },
              isReadOnly: true,
              nextAction: "Use these billing details for DRE calculations. Fees are negative, sales are positive.",
            },
          };
        }

        // Otherwise, list billing periods
        const periodsResponse = await fetchMercadoLivre(
          `/billing/integration/monthly/periods?user_id=${userId}&limit=${limit}`,
          token,
          BillingPeriodsResponseSchema,
        );

        const periods = periodsResponse.periods;

        // Group periods by year/month
        const periodsSummary = periods
          .slice(0, 12)
          .map(
            (p) =>
              `  ${p.year}-${String(p.month).padStart(2, "0")} | ${p.group} | ${p.status} | ${p.currency_id || "BRL"} ${(p.total || 0).toFixed(2)} | key: ${p.key}`,
          )
          .join("\n");

        // Calculate totals by group
        const totalByGroup = new Map<string, number>();
        for (const period of periods) {
          const existing = totalByGroup.get(period.group) || 0;
          totalByGroup.set(period.group, existing + (period.total || 0));
        }

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Available Billing Periods (${periods.length}):\n` +
                periodsSummary +
                `\n\nTotals by Group:\n` +
                Array.from(totalByGroup.entries())
                  .map(([g, t]) => `  ${g}: BRL ${t.toFixed(2)}`)
                  .join("\n"),
            },
          ],
          structuredContent: {
            periods,
            count: periods.length,
            totals_by_group: Object.fromEntries(totalByGroup),
            isReadOnly: true,
            nextAction: "To see details for a period, call again with period_key parameter from the list above.",
          },
        };
      } catch (error) {
        if (error instanceof MercadoLivreApiError) {
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
