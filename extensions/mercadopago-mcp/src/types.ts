import { z } from "zod";

// Plugin configuration
export const MercadoPagoConfigSchema = z.object({
  accessToken: z.string().min(1),
  environment: z.enum(["sandbox", "production"]).default("production"),
});

export type MercadoPagoConfig = z.infer<typeof MercadoPagoConfigSchema>;

// API response schemas
export const BalanceResponseSchema = z.object({
  available_balance: z.number(),
  unavailable_balance: z.number(),
  currency_id: z.string(),
});

export const ReportResponseSchema = z.object({
  id: z.number().optional(),
  status: z.string().optional(),
  file_name: z.string(),
});

// Tool output schemas
export const BalanceOutputSchema = z.object({
  available: z.number(),
  pending: z.number(),
  total: z.number(),
  currency: z.string(),
});

export const CashflowOutputSchema = z.object({
  period: z.object({
    start_date: z.string(),
    end_date: z.string(),
  }),
  total_inflow: z.number(),
  total_outflow: z.number(),
  net_change: z.number(),
  transaction_count: z.number(),
});

export const TransactionSchema = z.object({
  id: z.string(),
  date: z.string(),
  type: z.string(),
  description: z.string(),
  gross_amount: z.number(),
  net_amount: z.number(),
  fee_amount: z.number(),
  currency: z.string(),
});

export type Balance = z.infer<typeof BalanceOutputSchema>;
export type Cashflow = z.infer<typeof CashflowOutputSchema>;
export type Transaction = z.infer<typeof TransactionSchema>;
