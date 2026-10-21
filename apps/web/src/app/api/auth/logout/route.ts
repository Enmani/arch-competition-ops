import { apiDeps } from "@/lib/api/deps";
import { createAuthHandlers } from "@/lib/api/auth-routes";

export const dynamic = "force-dynamic";

// POST only: a GET logout would let any page sign users out via an image tag or link.
export const POST = createAuthHandlers(apiDeps).logout;
