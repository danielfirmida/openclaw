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
  const tokenManager = createTokenManager(config);

  // Track user ID after authentication (set during OAuth flow)
  let userId: number | null = null;

  // Helper to get user ID
  const getUserId = () => userId;

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

          // Open URL if possible
          await ctx.openUrl(url);

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
                  kind: "oauth",
                  accessToken: tokenState.access,
                  refreshToken: tokenState.refresh,
                  expiresAt: tokenState.expires,
                  scopes: ["read", "offline_access"],
                } as const,
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

  // Register read-only tools
  // Note: userId is already captured during OAuth flow (line 85), so no need to re-extract
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
