"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLayoutEffect, useRef, useState, type FormEvent, type PropsWithChildren } from "react";

import { AuthDialog } from "@/components/auth-dialog";
import { LocaleSwitcher } from "@/components/locale-switcher";
import { ThemeToggle } from "@/components/theme-toggle";
import { TopbarSearch } from "@/components/topbar-search";
import { buildLocalePath, stripLocalePrefix, type AppLocale } from "@/i18n/config";
import { AuthDialogContext, type AuthMode } from "@/lib/auth-dialog";
import type { AppDictionary } from "@/i18n/dictionaries";

type SiteShellProps = PropsWithChildren<{
  authCopy: AppDictionary["auth"];
  authUserEmail?: string | null;
  copy: AppDictionary["shell"];
  locale: AppLocale;
  showOpsLink?: boolean;
}>;

export const SiteShell = ({ authCopy, authUserEmail, children, copy, locale, showOpsLink = false }: SiteShellProps) => {
  const pathname = usePathname();
  const router = useRouter();
  const [authMode, setAuthMode] = useState<AuthMode | null>(null);
  const frameRef = useRef<HTMLDivElement | null>(null);
  const topbarRef = useRef<HTMLElement | null>(null);
  const barePathname = stripLocalePrefix(pathname);
  const discoverSurface =
    barePathname === "/discover" ||
    barePathname.startsWith("/opportunities/") ||
    barePathname.startsWith("/competitions/");
  const supportSurface = barePathname.startsWith("/support");
  const authSurface = barePathname.startsWith("/login") || barePathname.startsWith("/register");

  const navigation = [
    { href: buildLocalePath(locale, "/discover"), label: copy.nav.radar },
    { href: buildLocalePath(locale, "/dashboard"), label: copy.nav.workspace },
    // The setup page, not the protocol endpoint: `/mcp` answers MCP clients only.
    { href: buildLocalePath(locale, "/connect"), label: copy.nav.connect },
    // The pipeline view is administrator-only (ARCH_OPS_ADMIN_EMAILS); hide the link for everyone else.
    ...(showOpsLink ? [{ href: buildLocalePath(locale, "/ops"), label: copy.nav.pipeline }] : []),
  ];
  const utilityLinks = [
    { href: buildLocalePath(locale, "/pricing"), label: copy.utility.pricing },
    { href: buildLocalePath(locale, "/support"), label: copy.utility.support },
  ];

  // Sign out without leaving the page: post the same form, then refresh the server components.
  // Without JavaScript the form posts normally and lands on the sign-in page.
  const signOut = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    try {
      const response = await fetch("/api/auth/logout", {
        body: new FormData(form),
        headers: { accept: "application/json" },
        method: "POST",
      });
      if (response.ok) {
        router.refresh();
        return;
      }
    } catch {
      // Fall through to the plain form post.
    }
    form.submit();
  };

  const describeSurface = () => {
    if (barePathname.startsWith("/ops")) {
      return copy.captions.ops;
    }
    if (barePathname.startsWith("/dashboard")) {
      return copy.captions.dashboard;
    }
    if (authSurface) {
      return copy.captions.auth;
    }
    if (barePathname.startsWith("/connect")) {
      return copy.captions.connect;
    }
    if (discoverSurface) {
      return copy.captions.discover;
    }
    return copy.captions.fallback;
  };

  const resolveActive = (href: string) => {
    const bareHref = stripLocalePrefix(href);
    if (bareHref === "/discover") {
      return barePathname === "/" || discoverSurface;
    }
    return barePathname === bareHref || barePathname.startsWith(`${bareHref}/`);
  };

  useLayoutEffect(() => {
    if (!frameRef.current || !topbarRef.current) {
      return;
    }

    const frame = frameRef.current;
    const topbar = topbarRef.current;
    let rafId = 0;

    const syncTopbarHeight = () => {
      const height = topbar.getBoundingClientRect().height;
      frame.style.setProperty("--shell-topbar-height", `${height}px`);
    };

    const scheduleSync = () => {
      cancelAnimationFrame(rafId);
      rafId = requestAnimationFrame(syncTopbarHeight);
    };

    scheduleSync();

    const observer = new ResizeObserver(scheduleSync);
    observer.observe(topbar);

    return () => {
      cancelAnimationFrame(rafId);
      observer.disconnect();
    };
  }, []);

  return (
    <AuthDialogContext.Provider value={setAuthMode}>
    <div className="page-shell">
      <a className="skip-link" href="#main-content">
        {copy.skipToContent}
      </a>
      <div className="site-frame route-shell" ref={frameRef}>
        <header className="topbar" ref={topbarRef}>
          <div className="brand-stack">
            <Link className="brand-title" href={buildLocalePath(locale, "/discover")}>
              {copy.brandTitle}
            </Link>
            {discoverSurface || supportSurface ? null : (
              <span className="brand-caption">{describeSurface()}</span>
            )}
          </div>
          {barePathname === "/discover" ? <TopbarSearch copy={copy.search} /> : null}
          <div className="nav-cluster">
            <nav className="nav-row" aria-label={copy.ariaLabels.primaryNav}>
              {navigation.map((item) => {
                const active = resolveActive(item.href);
                return (
                  <Link
                    key={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link${active ? " active" : ""}`}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
            </nav>
            <div className="utility-row" role="group" aria-label={copy.ariaLabels.context}>
              {utilityLinks.map((item) => {
                const active = resolveActive(item.href);
                return (
                  <Link
                    key={item.href}
                    aria-current={active ? "page" : undefined}
                    className={`nav-link${active ? " active" : ""}`}
                    href={item.href}
                  >
                    {item.label}
                  </Link>
                );
              })}
              {authUserEmail ? (
                <>
                  <span className="nav-link account-label" title={authUserEmail}>
                    {authUserEmail}
                  </span>
                  {/* Logout is a POST (a GET link could be triggered by any other site). */}
                  <form action="/api/auth/logout" className="inline-form" method="post" onSubmit={(event) => void signOut(event)}>
                    <input name="locale" type="hidden" value={locale} />
                    <button className="nav-link nav-link-button" type="submit">
                      {copy.utility.logout}
                    </button>
                  </form>
                </>
              ) : null}
              {authUserEmail ? null : (
                // One entry for both: registration is a link inside the sheet. The href is the
                // fallback for no JavaScript, a new tab and a copied link.
                <Link
                  className="nav-link"
                  href={buildLocalePath(locale, "/login")}
                  onClick={(event) => {
                    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
                      return;
                    }
                    event.preventDefault();
                    setAuthMode("login");
                  }}
                >
                  {copy.utility.login}
                </Link>
              )}
              <LocaleSwitcher
                activeLocale={locale}
                ariaLabel={copy.localeSwitcherLabel}
                localeNames={copy.localeNames}
              />
              <ThemeToggle copy={copy.theme} />
            </div>
          </div>
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
      {authMode ? (
        <AuthDialog
          closeLabel={copy.closeLabel}
          copy={authCopy}
          locale={locale}
          mode={authMode}
          onClose={() => setAuthMode(null)}
          onModeChange={setAuthMode}
        />
      ) : null}
    </div>
    </AuthDialogContext.Provider>
  );
};
