import { Type } from "@sinclair/typebox";

import { fetchMercadoLivre, MercadoLivreApiError } from "../client.js";
import { ItemsSearchResponseSchema, ItemSchema } from "../types.js";

export function createListItemsTool(getToken: () => Promise<string>, getUserId: () => number | null) {
  return {
    name: "mercadolivre_list_items",
    description:
      "List product listings from Mercado Livre seller account. " +
      "READ-ONLY operation - does not modify any data. " +
      "Returns item details including price, quantity, and status. " +
      "If item_id is provided, returns single item details instead of list.",
    parameters: Type.Object({
      item_id: Type.Optional(
        Type.String({
          description: "Specific item ID to fetch details for (e.g., MLB12345678)",
        }),
      ),
      status: Type.Optional(
        Type.String({
          description: "Filter by status: active, paused, closed",
        }),
      ),
      limit: Type.Optional(
        Type.Number({
          description: "Maximum items to return (default: 20, max: 50)",
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
        item_id?: string;
        status?: string;
        limit?: number;
        offset?: number;
      },
    ) {
      const { item_id, status, limit = 20, offset = 0 } = params;

      try {
        const token = await getToken();

        // If item_id provided, fetch single item
        if (item_id) {
          const item = await fetchMercadoLivre(`/items/${item_id}`, token, ItemSchema);

          return {
            content: [
              {
                type: "text" as const,
                text:
                  `Item: ${item.title}\n` +
                  `ID: ${item.id}\n` +
                  `Status: ${item.status}\n` +
                  `Price: ${item.currency_id} ${item.price.toFixed(2)}\n` +
                  `Available: ${item.available_quantity}\n` +
                  `Sold: ${item.sold_quantity}\n` +
                  `Category: ${item.category_id}\n` +
                  `Listing Type: ${item.listing_type_id}`,
              },
            ],
            structuredContent: {
              item,
              isReadOnly: true,
              nextAction: "Use mercadolivre_list_orders with status filter to see orders for this item.",
            },
          };
        }

        // Get user ID for items search
        const userId = getUserId();
        if (!userId) {
          throw new MercadoLivreApiError(
            "User ID not available",
            400,
            undefined,
            "Call mercadolivre_get_user_info first to get seller context.",
          );
        }

        // Build query params for items search
        const queryParams = new URLSearchParams();
        queryParams.set("limit", String(Math.min(limit, 50)));
        queryParams.set("offset", String(offset));

        if (status) {
          queryParams.set("status", status);
        }

        // Get item IDs
        const searchResponse = await fetchMercadoLivre(
          `/users/${userId}/items/search?${queryParams.toString()}`,
          token,
          ItemsSearchResponseSchema,
        );

        const itemIds = searchResponse.results;
        const paging = searchResponse.paging;

        // Fetch item details (batch up to 20 at a time)
        const items = [];
        const batchSize = 20;

        for (let i = 0; i < itemIds.length; i += batchSize) {
          const batchIds = itemIds.slice(i, i + batchSize);
          const idsParam = batchIds.join(",");

          // Multi-get endpoint
          const batchResponse = await fetchMercadoLivre(
            `/items?ids=${idsParam}`,
            token,
            ItemSchema.array(),
          );

          items.push(...batchResponse);
        }

        // Calculate totals
        const totalValue = items.reduce((sum, i) => sum + i.price * i.available_quantity, 0);
        const totalSold = items.reduce((sum, i) => sum + i.sold_quantity, 0);
        const currencies = [...new Set(items.map((i) => i.currency_id))];

        const itemsSummary = items
          .slice(0, 10)
          .map(
            (i) =>
              `  ${i.id} | ${i.status} | ${i.currency_id} ${i.price.toFixed(2)} | ${i.title.slice(0, 40)}`,
          )
          .join("\n");

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Found ${items.length} items (${paging.total} total):\n` +
                itemsSummary +
                (items.length > 10 ? `\n  ... and ${items.length - 10} more` : "") +
                `\n\nTotal Inventory Value: ${currencies[0] || "BRL"} ${totalValue.toFixed(2)}` +
                `\nTotal Sold: ${totalSold} units`,
            },
          ],
          structuredContent: {
            items,
            count: items.length,
            total_available: paging.total,
            total_inventory_value: totalValue,
            total_sold: totalSold,
            currency: currencies[0] || "BRL",
            pagination: {
              limit: paging.limit,
              offset: paging.offset,
              has_more: paging.offset + paging.limit < paging.total,
            },
            isReadOnly: true,
            nextAction:
              paging.offset + paging.limit < paging.total
                ? `More items available. Set offset=${paging.offset + paging.limit} for next page.`
                : "Use mercadolivre_get_billing to see fees and commissions.",
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
