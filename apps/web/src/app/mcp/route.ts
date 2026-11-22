import { cloudflareClientIp } from "@/lib/mcp/access";
import { createMcpHandler } from "@/lib/mcp/http";
import { getStorage } from "@/lib/server-storage";

export const dynamic = "force-dynamic";

export const POST = createMcpHandler(async () => (await getStorage()).opportunities, {
  getStorage: async () => (await getStorage()).mcp,
  getAnonymousIp: cloudflareClientIp,
  getAnonymousSalt: () => process.env.ARCH_MCP_ANONYMOUS_SALT ||
    (process.env.NODE_ENV === "development" ? "arch-mcp-local-development" : undefined),
});
export const GET = POST;
