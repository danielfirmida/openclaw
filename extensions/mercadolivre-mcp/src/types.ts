import { z } from "zod";

// Plugin configuration
export const MercadoLivreConfigSchema = z.object({
  clientId: z.string().min(1),
  clientSecret: z.string().min(1),
  redirectUri: z.string().default("http://localhost:8888/callback"),
});

export type MercadoLivreConfig = z.infer<typeof MercadoLivreConfigSchema>;

// Token response from OAuth
export const TokenResponseSchema = z.object({
  access_token: z.string(),
  token_type: z.literal("bearer"),
  expires_in: z.number(),
  scope: z.string(),
  user_id: z.number(),
  refresh_token: z.string(),
});

export type TokenResponse = z.infer<typeof TokenResponseSchema>;

// Internal token state
export type TokenState = {
  access: string;
  refresh: string;
  expires: number; // Unix timestamp
  userId: number;
};

// User info response
export const UserSchema = z.object({
  id: z.number(),
  nickname: z.string(),
  site_id: z.string(),
  email: z.string().optional(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  seller_reputation: z
    .object({
      level_id: z.string().nullable(),
      power_seller_status: z.string().nullable(),
      transactions: z
        .object({
          completed: z.number(),
          canceled: z.number(),
        })
        .optional(),
    })
    .optional(),
});

export type User = z.infer<typeof UserSchema>;

// Orders response
export const OrderItemSchema = z.object({
  item: z.object({
    id: z.string(),
    title: z.string(),
    category_id: z.string().optional(),
  }),
  quantity: z.number(),
  unit_price: z.number(),
  currency_id: z.string(),
});

export const OrderPaymentSchema = z.object({
  id: z.number(),
  status: z.string(),
  transaction_amount: z.number(),
  currency_id: z.string(),
  date_approved: z.string().nullable(),
});

export const OrderSchema = z.object({
  id: z.number(),
  status: z.string(),
  date_created: z.string(),
  date_closed: z.string().nullable(),
  total_amount: z.number(),
  currency_id: z.string(),
  order_items: z.array(OrderItemSchema),
  payments: z.array(OrderPaymentSchema).optional(),
  buyer: z
    .object({
      id: z.number(),
      nickname: z.string(),
    })
    .optional(),
  shipping: z
    .object({
      id: z.number().nullable(),
      status: z.string().optional(),
    })
    .optional(),
});

export type Order = z.infer<typeof OrderSchema>;

export const OrdersSearchResponseSchema = z.object({
  results: z.array(OrderSchema),
  paging: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

// Items response
export const ItemSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: z.string(),
  price: z.number(),
  currency_id: z.string(),
  available_quantity: z.number(),
  sold_quantity: z.number(),
  category_id: z.string(),
  listing_type_id: z.string(),
  condition: z.string().optional(),
  permalink: z.string().optional(),
});

export type Item = z.infer<typeof ItemSchema>;

export const ItemsSearchResponseSchema = z.object({
  results: z.array(z.string()), // Item IDs
  paging: z.object({
    total: z.number(),
    limit: z.number(),
    offset: z.number(),
  }),
});

// Billing response
export const BillingPeriodSchema = z.object({
  key: z.string(),
  group: z.string(),
  year: z.number(),
  month: z.number(),
  status: z.string(),
  total: z.number().optional(),
  currency_id: z.string().optional(),
});

export type BillingPeriod = z.infer<typeof BillingPeriodSchema>;

export const BillingPeriodsResponseSchema = z.object({
  periods: z.array(BillingPeriodSchema),
});

export const BillingDetailSchema = z.object({
  detail_id: z.string().optional(),
  type: z.string(),
  description: z.string(),
  amount: z.number(),
  currency_id: z.string(),
  date: z.string().optional(),
});

export type BillingDetail = z.infer<typeof BillingDetailSchema>;

export const BillingDetailsResponseSchema = z.object({
  details: z.array(BillingDetailSchema),
  summary: z
    .object({
      total: z.number(),
      currency_id: z.string(),
    })
    .optional(),
});
