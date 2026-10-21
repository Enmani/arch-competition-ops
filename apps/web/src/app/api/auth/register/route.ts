import { apiDeps } from "@/lib/api/deps";
import { createAuthHandlers } from "@/lib/api/auth-routes";

export const dynamic = "force-dynamic";

export const POST = createAuthHandlers(apiDeps).register;
