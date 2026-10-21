import { apiDeps } from "@/lib/api/deps";
import { createSavedSearchHandlers } from "@/lib/api/saved-searches";

export const dynamic = "force-dynamic";

export const { DELETE, GET, POST } = createSavedSearchHandlers(apiDeps);
