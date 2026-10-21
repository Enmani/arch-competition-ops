import { apiDeps } from "@/lib/api/deps";
import { createWatchlistHandlers } from "@/lib/api/watchlists";

export const dynamic = "force-dynamic";

export const { DELETE, GET, POST } = createWatchlistHandlers(apiDeps);
