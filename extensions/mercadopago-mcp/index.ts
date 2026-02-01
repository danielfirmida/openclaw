import type { OpenClawPluginApi } from "../../src/plugins/types.js";

import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createGetCashflowTool } from "./src/tools/get-cashflow.js";
import { createListTransactionsTool } from "./src/tools/list-transactions.js";
import { MercadoPagoConfigSchema } from "./src/types.js";

export default function register(api: OpenClawPluginApi) {
  // Validate config
  const configResult = MercadoPagoConfigSchema.safeParse(api.pluginConfig);
  if (!configResult.success) {
    // Silently skip if not configured (optional extension)
    return;
  }

  const config = configResult.data;

  // Register tools directly with OpenClaw
  api.registerTool(createGetBalanceTool(config), { optional: true });
  api.registerTool(createGetCashflowTool(config), { optional: true });
  api.registerTool(createListTransactionsTool(config), { optional: true });
}
