import { Type } from "@sinclair/typebox";

import { fetchMercadoLivre, MercadoLivreApiError } from "../client.js";
import { OrdersSearchResponseSchema, OrderSchema } from "../types.js";

export function createListOrdersTool(getToken: () => Promise<string>, getUserId: () => number | null) {
  return {
    name: "mercadolivre_list_orders",
    description:
      "List orders from Mercado Livre seller account with optional filters. " +
      "READ-ONLY operation - does not modify any data. " +
      "Returns order details including items, payments, and shipping status. " +
      "If order_id is provided, returns single order details instead of list.",
    parameters: Type.Object({
      order_id: Type.Optional(
        Type.Number({
          description: "Specific order ID to fetch details for (overrides other filters)",
        }),
      ),
      status: Type.Optional(
        Type.String({
          description: "Filter by status: paid, shipped, delivered, cancelled",
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
      limit: Type.Optional(
        Type.Number({
          description: "Maximum orders to return (default: 20, max: 50)",
          minimum: 1,
          maximum: 50,
        }),
      ),
      offset: Type.Optional(
        Type.Number({
          description: "Offset for pagination (default: 0)",
          minimum: 0,
        }),
      ),
    }),

    async execute(
      _id: string,
      params: {
        order_id?: number;
        status?: string;
        date_from?: string;
        date_to?: string;
        limit?: number;
        offset?: number;
      },
    ) {
      const { order_id, status, date_from, date_to, limit = 20, offset = 0 } = params;

      try {
        const token = await getToken();

        // If order_id provided, fetch single order
        if (order_id) {
          const order = await fetchMercadoLivre(
            `/orders/${order_id}`,
            token,
            OrderSchema,
          );

          const itemsSummary = order.order_items
            .map((item) => `${item.item.title} x${item.quantity}`)
            .join(", ");

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Order #${order.id}\n` +
                  `Status: ${order.status}\n` +
                  `Date: ${order.date_created.split("T")[0]}\n` +
                  `Total: ${order.currency_id} ${order.total_amount.toFixed(2)}\n` +
                  `Items: ${itemsSummary}\n` +
                  `Buyer: ${order.buyer?.nickname ?? "N/A"}`,
              },
            ],
            structuredContent: {
              order,
              isReadOnly: true,
              nextAction: "Use mercadolivre_get_billing to see fees and commissions for this period.",
            },
          };
        }

        // Get user ID for seller orders search
        const userId = getUserId();
        if (!userId) {
          throw new MercadoLivreApiError(
            "User ID not available",
            400,
            undefined,
            "Call mercadolivre_get_user_info first to get seller context.",
          );
        }

        // Build query params for orders search
        const queryParams = new URLSearchParams();
        queryParams.set("seller", String(userId));
        queryParams.set("limit", String(Math.min(limit, 50)));
        queryParams.set("offset", String(offset));
        queryParams.set("sort", "date_desc");

        if (status) {
          queryParams.set("order.status", status);
        }

        // Date range
        if (date_from) {
          queryParams.set("order.date_created.from", `${date_from}T00:00:00.000-00:00`);
        }
        if (date_to) {
          queryParams.set("order.date_created.to", `${date_to}T23:59:59.999-00:00`);
        }

        const response = await fetchMercadoLivre(
          `/orders/search?${queryParams.toString()}`,
          token,
          OrdersSearchResponseSchema,
        );

        const orders = response.results;
        const paging = response.paging;

        // Calculate page totals (not overall totals)
        const pageTotal = orders.reduce((sum, o) => sum + o.total_amount, 0);
        const currencies = [...new Set(orders.map((o) => o.currency_id))];

        const ordersSummary = orders
          .slice(0, 10)
          .map(
            (o) =>
              `  ${o.date_created.split("T")[0]} | #${o.id} | ${o.status} | ${o.currency_id} ${o.total_amount.toFixed(2)}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${orders.length} orders (${paging.total} total):\n` +
                ordersSummary +
                (orders.length > 10 ? `\n  ... and ${orders.length - 10} more` : "") +
                `\n\nPage Total: ${currencies[0] || "BRL"} ${pageTotal.toFixed(2)}`,
            },
          ],
          structuredContent: {
            orders,
            count: orders.length,
            total_available: paging.total,
            page_total: pageTotal,
            currency: currencies[0] || "BRL",
            pagination: {
              limit: paging.limit,
              offset: paging.offset,
              has_more: paging.offset + paging.limit < paging.total,
            },
            isReadOnly: true,
            nextAction:
              paging.offset + paging.limit < paging.total
                ? `More orders available. Set offset=${paging.offset + paging.limit} for next page.`
                : "Use mercadolivre_get_billing to see billing details and fees.",
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
