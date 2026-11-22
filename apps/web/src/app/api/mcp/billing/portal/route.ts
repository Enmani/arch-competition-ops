import { apiDeps } from "@/lib/api/deps";
import { createMcpBillingHandlers } from "@/lib/api/mcp-billing";

export const dynamic = "force-dynamic";
export const POST = createMcpBillingHandlers(apiDeps).portal;
