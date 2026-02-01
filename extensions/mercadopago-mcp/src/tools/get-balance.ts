import { Type } from "@sinclair/typebox";
import { z } from "zod";

import { fetchMercadoPago, MercadoPagoApiError } from "../client.js";
import type { MercadoPagoConfig } from "../types.js";

// Schema for user info response
const UserInfoSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  email: z.string(),
  country_id: z.string(),
});

// Schema for balance (if available)
const BalanceResponseSchema = z.object({
  available_balance: z.number(),
  unavailable_balance: z.number(),
  currency_id: z.string(),
});

export function createGetBalanceTool(config: MercadoPagoConfig) {
  return {
    name: "mercadopago_get_balance",
    description: "Get current MercadoPago account balance (available and pending). Note: requires special API permissions - use mercadopago_list_transactions to see payment totals if balance is not available.",
    parameters: Type.Object({}),

    async execute() {
      try {
        // First try the balance endpoint
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
          // If balance endpoint fails, try to get user info at least
          if (error.status === 404 || error.status === 403) {
            try {
              const userInfo = await fetchMercadoPago(
                "/users/me",
                config.accessToken,
                UserInfoSchema,
              );

              return {
                content: [
                  {
                    type: "text" as const,
                    text: `Balance API not available for this account (${userInfo.nickname}). This app may not have the required permissions. Use mercadopago_list_transactions to see recent payment activity instead.`,
                  },
                ],
                structuredContent: {
                  error: "Balance endpoint not available",
                  status: error.status,
                  recoverable: false,
                  account: {
                    id: userInfo.id,
                    nickname: userInfo.nickname,
                    country: userInfo.country_id,
                  },
                  hint: "Use mercadopago_list_transactions to see payment activity. Balance API requires special permissions from MercadoPago.",
                },
                isError: true,
              };
            } catch {
              // Fall through to original error
            }
          }

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
