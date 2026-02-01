import { Type } from "@sinclair/typebox";

import { fetchMercadoPago, MercadoPagoApiError } from "../client.js";
import { BalanceResponseSchema, type MercadoPagoConfig } from "../types.js";

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
          BalanceResponseSchema,
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
