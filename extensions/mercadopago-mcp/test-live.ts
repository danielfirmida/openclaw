#!/usr/bin/env npx tsx
/**
 * Live test for MercadoPago extension
 * Usage: npx tsx extensions/mercadopago-mcp/test-live.ts
 */

import { createGetBalanceTool } from "./src/tools/get-balance.js";
import { createGetCashflowTool } from "./src/tools/get-cashflow.js";
import { createListTransactionsTool } from "./src/tools/list-transactions.js";
import type { MercadoPagoConfig } from "./src/types.js";

const ACCESS_TOKEN = "APP_USR-6783787246908177-020109-47fd2cc2d59b3c4178b0c8dee35800df-136283865";

const config: MercadoPagoConfig = {
  accessToken: ACCESS_TOKEN,
  environment: "production",
};

async function main() {
  console.log("🧪 Testing MercadoPago MCP Extension\n");

  // Test 1: Get Balance
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📊 Test 1: Get Balance");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const balanceTool = createGetBalanceTool(config);
  try {
    const balanceResult = await balanceTool.execute();
    console.log("✅ Success!");
    console.log("Text:", balanceResult.content[0].text);
    console.log("Structured:", JSON.stringify(balanceResult.structuredContent, null, 2));
  } catch (error) {
    console.log("❌ Error:", error);
  }

  console.log("\n");

  // Test 2: List Transactions (last 7 days)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("📋 Test 2: List Transactions (last 7 days, limit 5)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const transactionsTool = createListTransactionsTool(config);
  try {
    const txResult = await transactionsTool.execute("test-id", { limit: 5 });
    console.log("✅ Success!");
    console.log("Text:", txResult.content[0].text);
    if (txResult.structuredContent) {
      console.log("Count:", (txResult.structuredContent as any).count || (txResult.structuredContent as any).transactions?.length || 0);
    }
  } catch (error) {
    console.log("❌ Error:", error);
  }

  console.log("\n");

  // Test 3: Get Cashflow (last 30 days)
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");
  console.log("💰 Test 3: Get Cashflow (last 30 days)");
  console.log("━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━");

  const today = new Date();
  const thirtyDaysAgo = new Date(today);
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);

  const endDate = today.toISOString().split("T")[0];
  const startDate = thirtyDaysAgo.toISOString().split("T")[0];

  console.log(`Date range: ${startDate} to ${endDate}`);
  console.log("⏳ Generating report (may take up to 60 seconds)...\n");

  const cashflowTool = createGetCashflowTool(config);
  try {
    const cashflowResult = await cashflowTool.execute("test-id", {
      start_date: startDate,
      end_date: endDate
    });
    console.log("✅ Success!");
    console.log("Text:", cashflowResult.content[0].text);
    console.log("Structured:", JSON.stringify(cashflowResult.structuredContent, null, 2));
  } catch (error) {
    console.log("❌ Error:", error);
  }

  console.log("\n🎉 Tests complete!");
}

main().catch(console.error);
