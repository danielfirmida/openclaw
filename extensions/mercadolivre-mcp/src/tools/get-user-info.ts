import { Type } from "@sinclair/typebox";

import { fetchMercadoLivre, MercadoLivreApiError } from "../client.js";
import { UserSchema } from "../types.js";

export function createGetUserInfoTool(getToken: () => Promise<string>) {
  return {
    name: "mercadolivre_get_user_info",
    description:
      "Get Mercado Livre seller account info and reputation. " +
      "READ-ONLY operation - does not modify any data. " +
      "Use this FIRST to get seller context (site_id, user_id) before querying orders or items.",
    parameters: Type.Object({}),

    async execute() {
      try {
        const token = await getToken();
        const user = await fetchMercadoLivre("/users/me", token, UserSchema);

        const reputation = user.seller_reputation;
        const transactions = reputation?.transactions;

        return {
          content: [
            {
              type: "text" as const,
              text:
                `Seller: ${user.nickname} (ID: ${user.id})\n` +
                `Site: ${user.site_id}\n` +
                `Reputation: ${reputation?.level_id ?? "N/A"}\n` +
                `Power Seller: ${reputation?.power_seller_status ?? "N/A"}\n` +
                `Transactions: ${transactions?.completed ?? 0} completed, ${transactions?.canceled ?? 0} canceled`,
            },
          ],
          structuredContent: {
            ...user,
            isReadOnly: true,
            nextAction: "Use mercadolivre_list_orders to see recent orders, or mercadolivre_list_items to see product listings.",
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
