"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import {
  buildLocalePath,
  localeCookieName,
  stripLocalePrefix,
  type AppLocale,
} from "@/i18n/config";

type LocaleSwitcherProps = {
  activeLocale: AppLocale;
  ariaLabel: string;
  localeAbbreviations: Record<AppLocale, string>;
  localeNames: Record<AppLocale, string>;
};

export const LocaleSwitcher = ({
  activeLocale,
  ariaLabel,
  localeNames,
}: LocaleSwitcherProps) => {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const barePathname = stripLocalePrefix(pathname);
  const search = searchParams.toString();
  const [isOpen, setIsOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number; width: number } | null>(
    null,
  );
  const menuId = useId();
  const containerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);

  const buildHref = (targetLocale: AppLocale) => {
    const href = buildLocalePath(targetLocale, barePathname);
    return search ? `${href}?${search}` : href;
  };

  const setLocaleCookie = (targetLocale: AppLocale) => {
    document.cookie = `${localeCookieName}=${targetLocale}; path=/; max-age=31536000; samesite=lax`;
  };

  useEffect(() => {
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);

    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, []);

  useEffect(() => {
    if (!isOpen || !triggerRef.current) {
      return;
    }

    const syncPosition = () => {
      if (!triggerRef.current) {
        return;
      }

      const rect = triggerRef.current.getBoundingClientRect();
      setMenuPosition({
        left: Math.max(8, rect.right - Math.max(rect.width * 1.9, 136)),
        top: rect.bottom + 4,
        width: Math.max(rect.width * 1.9, 136),
      });
    };

    syncPosition();
    window.addEventListener("resize", syncPosition);
    window.addEventListener("scroll", syncPosition, true);

    return () => {
      window.removeEventListener("resize", syncPosition);
      window.removeEventListener("scroll", syncPosition, true);
    };
  }, [isOpen]);

  return (
    <div aria-label={ariaLabel} className={`locale-switcher${isOpen ? " is-open" : ""}`} ref={containerRef}>
      <button
        aria-controls={menuId}
        aria-expanded={isOpen}
        aria-haspopup="true"
        aria-label={`${ariaLabel}: ${localeNames[activeLocale]}`}
        className="locale-trigger"
        onClick={() => setIsOpen((current) => !current)}
        ref={triggerRef}
        type="button"
      >
        <span aria-hidden="true" className="locale-globe">
          <svg fill="none" viewBox="0 0 16 16" xmlns="http://www.w3.org/2000/svg">
            <circle cx="8" cy="8" r="5.25" stroke="currentColor" strokeWidth="1.15" />
            <path
              d="M8 2.75C9.52 4.16 10.38 6.04 10.38 8C10.38 9.96 9.52 11.84 8 13.25C6.48 11.84 5.62 9.96 5.62 8C5.62 6.04 6.48 4.16 8 2.75Z"
              stroke="currentColor"
              strokeWidth="1.15"
            />
            <path d="M3 6.3H13" stroke="currentColor" strokeWidth="1.15" />
            <path d="M3 9.7H13" stroke="currentColor" strokeWidth="1.15" />
          </svg>
        </span>
        <span className="locale-trigger-label">{localeNames[activeLocale]}</span>
      </button>

      {typeof document !== "undefined" && isOpen && menuPosition
        ? createPortal(
            <div
              className="locale-menu"
              id={menuId}
              style={{
                left: `${menuPosition.left}px`,
                minWidth: `${menuPosition.width}px`,
                position: "fixed",
                right: "auto",
                top: `${menuPosition.top}px`,
              }}
            >
              {(["zh", "en"] as const).map((locale) => {
                const active = locale === activeLocale;

                return (
                  <Link
                    key={locale}
                    aria-current={active ? "true" : undefined}
                    className={`locale-menu-item${active ? " active" : ""}`}
                    href={buildHref(locale)}
                    onClick={() => {
                      setLocaleCookie(locale);
                      setIsOpen(false);
                    }}
                  >
                    <span className="locale-menu-label">{localeNames[locale]}</span>
                  </Link>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </div>
  );
};
