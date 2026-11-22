import { apiDeps } from "@/lib/api/deps";
import { createMcpKeyHandlers } from "@/lib/api/mcp-keys";

export const dynamic = "force-dynamic";
export const { DELETE, GET, POST } = createMcpKeyHandlers(apiDeps);
