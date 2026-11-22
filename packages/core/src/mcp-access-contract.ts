import { z } from "zod";

// The Worker free-plan request budget is shared with the website.
export const MCP_ANONYMOUS_DAILY_BUDGET = 20_000;

export const MCP_PLANS = {
  anonymous: { monthlyLimit: 100, minuteLimit: 5 },
  free: { monthlyLimit: 300, minuteLimit: 20 },
  paid: { monthlyLimit: 5_000, minuteLimit: 60 },
} as const;

// Display only. When amounts change, update the Stripe recurring Prices and
// their configured IDs, and update the corresponding amounts here.
export const MCP_PRICING = { currency: "EUR", month: 9, year: 90 } as const;

export const MCP_MAX_ACTIVE_KEYS = 5;
export const MCP_KEY_ID_PATTERN = /^[A-Za-z0-9_-]{12}$/;
export const MCP_KEY_PATTERN = /^arch_mcp_([A-Za-z0-9_-]{12})\.[A-Za-z0-9_-]{43}$/;
export const MCP_ACCOUNT_PATH = "/en/dashboard";

export const mcpPlanSchema = z.enum(["anonymous", "free", "paid"]);
export const mcpApiKeyCreateSchema = z.object({ name: z.string().trim().min(1).max(80) }).strict();
export const mcpApiKeyRevokeSchema = z.object({ id: z.string().regex(MCP_KEY_ID_PATTERN) }).strict();
export const mcpApiKeySchema = mcpApiKeyRevokeSchema.extend({
  prefix: z.string(),
  name: z.string(),
  createdAt: z.string().datetime(),
  lastUsedAt: z.string().datetime().nullable(),
  revokedAt: z.string().datetime().nullable(),
});
export const mcpApiKeyCreatedSchema = z.object({
  item: mcpApiKeySchema,
  key: z.string().regex(MCP_KEY_PATTERN),
});
export const mcpApiKeyListSchema = z.object({
  items: z.array(mcpApiKeySchema),
  maxActiveKeys: z.number().int().positive(),
});
export const mcpUsageSchema = z.object({
  plan: mcpPlanSchema,
  month: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    resetsAt: z.string().datetime(),
  }),
  minute: z.object({
    used: z.number().int().nonnegative(),
    limit: z.number().int().positive(),
    resetsAt: z.string().datetime(),
  }),
});

const mcpBillingIntervalSchema = z.enum(["month", "year"]);
export const mcpBillingSessionRequestSchema = z.object({ locale: z.enum(["en", "zh"]) }).strict();
export const mcpBillingCheckoutRequestSchema = mcpBillingSessionRequestSchema.extend({
  interval: mcpBillingIntervalSchema,
});
export const mcpBillingSessionSchema = z.object({ url: z.string().url() });

export type McpApiKey = z.infer<typeof mcpApiKeySchema>;
export type McpPlan = z.infer<typeof mcpPlanSchema>;
export type McpUsage = z.infer<typeof mcpUsageSchema>;
export type McpBillingInterval = z.infer<typeof mcpBillingIntervalSchema>;
export type McpBillingCheckoutRequest = z.infer<typeof mcpBillingCheckoutRequestSchema>;
export type McpBillingSession = z.infer<typeof mcpBillingSessionSchema>;

export const mcpBillingReturnSchema = z.enum(["success", "cancel", "portal"]);
export const mcpBillingWebhookAckSchema = z.object({ received: z.literal(true) });
export type McpBillingReturn = z.infer<typeof mcpBillingReturnSchema>;
