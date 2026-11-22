import { apiDeps } from "@/lib/api/deps";
import { createMcpUsageHandler } from "@/lib/api/mcp-keys";

export const dynamic = "force-dynamic";
export const GET = createMcpUsageHandler(apiDeps);
