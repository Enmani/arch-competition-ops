import type { Metadata } from "next";

import { MCP_MAX_ACTIVE_KEYS } from "@arch-competition/core";

import { ConnectSurface } from "@/components/connect-surface";
import { buildLocalePath } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import { pickConnectCopy } from "@/i18n/slices";
import { getCurrentAuthUser } from "@/lib/auth";
import { MCP_DEFAULT_ORIGIN, mcpEndpoint } from "@/lib/mcp-connect";
import { buildPageMetadata, getSiteOrigin } from "@/lib/page-metadata";
import { getStorage } from "@/lib/server-storage";
import { resolveSiteOrigin } from "@/lib/site-url";

export const dynamic = "force-dynamic";

type ConnectPageProps = { params: Promise<{ locale: string }> };

export const generateMetadata = async ({ params }: ConnectPageProps): Promise<Metadata> =>
  buildPageMetadata(resolveLocaleOrNotFound((await params).locale), "connect", "/connect");

/**
 * The address people paste into their client. SITE_URL when set; the request host only in local
 * development (so a local server shows its own endpoint); otherwise the production origin. The
 * Host header is never trusted for this in production.
 */
const resolveEndpointOrigin = async () => {
  const configured = resolveSiteOrigin({ configured: process.env.SITE_URL });
  if (configured) return configured;
  if (process.env.NODE_ENV === "development") return (await getSiteOrigin()) ?? MCP_DEFAULT_ORIGIN;
  return MCP_DEFAULT_ORIGIN;
};

const ConnectPage = async ({ params }: ConnectPageProps) => {
  const locale = resolveLocaleOrNotFound((await params).locale);
  const dictionary = getDictionary(locale);
  const user = await getCurrentAuthUser();
  const [origin, initialKeys] = await Promise.all([
    resolveEndpointOrigin(),
    user ? (await getStorage()).mcp.listKeys(user.id) : Promise.resolve(null),
  ]);
  const connectPath = buildLocalePath(locale, "/connect");

  return (
    <ConnectSurface
      accountHref={`${buildLocalePath(locale, "/dashboard")}#mcp-keys`}
      copy={pickConnectCopy(dictionary)}
      endpoint={mcpEndpoint(origin)}
      initialKeys={initialKeys}
      locale={locale}
      maxActiveKeys={MCP_MAX_ACTIVE_KEYS}
      pricingHref={buildLocalePath(locale, "/pricing")}
      registerHref={`${buildLocalePath(locale, "/register")}?next=${encodeURIComponent(connectPath)}`}
    />
  );
};

export default ConnectPage;
