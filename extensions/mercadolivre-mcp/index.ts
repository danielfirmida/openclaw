import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { createTokenManager, createAuthorizationUrl, exchangeCodeForTokens } from "./src/client.js";
import { createGetUserInfoTool } from "./src/tools/get-user-info.js";
import { createListOrdersTool } from "./src/tools/list-orders.js";
import { createListItemsTool } from "./src/tools/list-items.js";
import { createGetBillingTool } from "./src/tools/get-billing.js";
import { MercadoLivreConfigSchema } from "./src/types.js";

export default function register(api: OpenClawPluginApi) {
  // Validate config
  const configResult = MercadoLivreConfigSchema.safeParse(api.pluginConfig);
  if (!configResult.success) {
    // Silently skip if not configured (optional extension)
    return;
  }

  const config = configResult.data;

  // Track user ID (set during OAuth flow or fetched from API for direct token)
  let userId: number | null = null;

  // Helper to get user ID
  const getUserId = () => userId;

  // Mode 1: Direct access token (like MercadoPago)
  if (config.accessToken) {
    // Simple token getter that returns the static token
    const getToken = async () => config.accessToken!;

    // Extract user ID from access token format: APP_USR-{app_id}-{date}-{hash}-{user_id}
    const tokenParts = config.accessToken.split("-");
    if (tokenParts.length >= 5) {
      const parsedUserId = parseInt(tokenParts[tokenParts.length - 1], 10);
      if (!isNaN(parsedUserId)) {
        userId = parsedUserId;
      }
    }

    // Register read-only tools with direct token
    api.registerTool(createGetUserInfoTool(getToken), { optional: true });
    api.registerTool(createListOrdersTool(getToken, getUserId), { optional: true });
    api.registerTool(createListItemsTool(getToken, getUserId), { optional: true });
    api.registerTool(createGetBillingTool(getToken, getUserId), { optional: true });

    return;
  }

  // Mode 2: OAuth flow with client credentials
  if (!config.clientId || !config.clientSecret) {
    // Neither mode configured - skip
    return;
  }

  const tokenManager = createTokenManager(config);

  // Register OAuth provider for authentication
  api.registerProvider({
    id: "mercadolivre",
    label: "Mercado Livre",
    envVars: ["MERCADOLIVRE_CLIENT_ID", "MERCADOLIVRE_CLIENT_SECRET"],
    auth: [
      {
        id: "authorization_code",
        label: "Browser Authorization",
        hint: "Authorize via browser (VPS compatible with URL paste)",
        kind: "oauth",
        run: async (ctx) => {
          // Generate authorization URL with PKCE
          const { url, state } = createAuthorizationUrl(config);

          // Show URL to user
          await ctx.prompter.note(
            "Mercado Livre Authorization",
            `Open this URL in your browser:\n\n${url}\n\nAfter authorizing, you'll be redirected. Copy the full redirect URL and paste it below.`,
          );

          // Open URL if possible (ignore failures on headless/VPS)
          try {
            await ctx.openUrl(url);
          } catch {
            // no-op: user can open the URL manually
          }

          // Get redirect URL from user (VPS compatible)
          const redirectUrl = await ctx.prompter.text(
            "Redirect URL",
            "Paste the full URL from your browser after authorization:",
          );

          if (!redirectUrl) {
            throw new Error("Authorization cancelled");
          }

          // Parse redirect URL
          const parsedUrl = new URL(redirectUrl);
          const code = parsedUrl.searchParams.get("code");
          const returnedState = parsedUrl.searchParams.get("state");

          if (!code) {
            throw new Error("No authorization code in redirect URL");
          }

          // Validate state parameter
          if (returnedState !== state.state) {
            throw new Error("State mismatch - possible CSRF attack");
          }

          // Exchange code for tokens
          const tokenState = await exchangeCodeForTokens(config, code, state.codeVerifier);

          // Store tokens
          tokenManager.setToken(tokenState);
          userId = tokenState.userId;

          return {
            profiles: [
              {
                profileId: `mercadolivre-${tokenState.userId}`,
                credential: {
                  type: "oauth",
                  provider: "mercadolivre",
                  access: tokenState.access,
                  refresh: tokenState.refresh,
                  expires: tokenState.expires,
                },
              },
            ],
            notes: [
              `Authenticated as Mercado Livre user ${tokenState.userId}`,
              "Token expires in 6 hours and will auto-refresh",
              "This plugin is READ-ONLY - no write operations allowed",
            ],
          };
        },
      },
    ],
  });

  // Register read-only tools with OAuth token manager
  api.registerTool(createGetUserInfoTool(tokenManager.getToken.bind(tokenManager)), {
    optional: true,
  });
  api.registerTool(createListOrdersTool(tokenManager.getToken.bind(tokenManager), getUserId), {
    optional: true,
  });
  api.registerTool(createListItemsTool(tokenManager.getToken.bind(tokenManager), getUserId), {
    optional: true,
  });
  api.registerTool(createGetBillingTool(tokenManager.getToken.bind(tokenManager), getUserId), {
    optional: true,
  });
}
