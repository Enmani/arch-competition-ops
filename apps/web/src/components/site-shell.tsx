"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef, type PropsWithChildren } from "react";

import { LocaleSwitcher } from "@/components/locale-switcher";
import { buildLocalePath, stripLocalePrefix, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type SiteShellProps = PropsWithChildren<{
  authUserEmail?: string | null;
  copy: AppDictionary["shell"];
  locale: AppLocale;
  showOpsLink?: boolean;
}>;

export const SiteShell = ({ authUserEmail, children, copy, locale, showOpsLink = false }: SiteShellProps) => {
  const pathname = usePathname();
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
    // The pipeline view is administrator-only (ARCH_OPS_ADMIN_EMAILS); hide the link for everyone else.
    ...(showOpsLink ? [{ href: buildLocalePath(locale, "/ops"), label: copy.nav.pipeline }] : []),
  ];
  const utilityLinks = [{ href: buildLocalePath(locale, "/support"), label: copy.utility.support }];
  const authLinks = authUserEmail
    ? []
    : [
        { href: buildLocalePath(locale, "/login"), label: copy.utility.login },
        { href: buildLocalePath(locale, "/register"), label: copy.utility.register },
      ];

  const describeSurface = () => {
    if (barePathname.startsWith("/ops")) {
      return copy.captions.ops;
    }
    if (barePathname.startsWith("/dashboard")) {
      return copy.captions.dashboard;
    }
    if (supportSurface) {
      return copy.captions.support;
    }
    if (authSurface) {
      return copy.captions.auth;
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
                  <form action="/api/auth/logout" className="inline-form" method="post">
                    <input name="locale" type="hidden" value={locale} />
                    <button className="nav-link nav-link-button" type="submit">
                      {copy.utility.logout}
                    </button>
                  </form>
                </>
              ) : null}
              {authLinks.map((item) => {
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
              <LocaleSwitcher
                activeLocale={locale}
                ariaLabel={copy.localeSwitcherLabel}
                localeNames={copy.localeNames}
              />
            </div>
          </div>
        </header>
        <div id="main-content" tabIndex={-1}>
          {children}
        </div>
      </div>
    </div>
  );
};
