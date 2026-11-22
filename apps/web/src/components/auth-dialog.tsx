"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";

import { ConsentLine } from "@/components/consent-line";
import type { AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import type { AuthMode } from "@/lib/auth-dialog";

type AuthDialogProps = {
  closeLabel: string;
  consentCopy: AppDictionary["legal"]["consent"];
  copy: AppDictionary["auth"];
  locale: AppLocale;
  mode: AuthMode;
  onClose: () => void;
  onModeChange: (mode: AuthMode) => void;
};

/**
 * Sign-in and registration as a sheet over the current page: no navigation. The same form the
 * /login and /register pages post, sent with fetch and `Accept: application/json`; on success the
 * server components are refreshed in place (the account appears, watch state loads) and the page
 * keeps its scroll position and list. The pages stay as the no-JavaScript and direct-link path.
 */
export const AuthDialog = ({ closeLabel, consentCopy, copy, locale, mode, onClose, onModeChange }: AuthDialogProps) => {
  const router = useRouter();
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const text = copy[mode];
  const otherMode: AuthMode = mode === "login" ? "register" : "login";

  useEffect(() => {
    const dialog = dialogRef.current;
    if (dialog && !dialog.open) {
      dialog.showModal();
    }
    // Keep the page's scrollbar space while the page behind is locked, so nothing shifts.
    const root = document.documentElement;
    const previous = { gutter: root.style.scrollbarGutter, overflow: root.style.overflow };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = previous.overflow;
      root.style.scrollbarGutter = previous.gutter;
      if (dialog?.open) {
        dialog.close();
      }
    };
  }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (pending) {
      return;
    }
    setPending(true);
    setError(null);
    let reason = "unexpected";
    try {
      const response = await fetch(`/api/auth/${mode}`, {
        body: new FormData(event.currentTarget),
        headers: { accept: "application/json" },
        method: "POST",
      });
      const body: unknown = await response.json().catch(() => null);
      if (response.ok) {
        router.refresh();
        onClose();
        return;
      }
      if (typeof body === "object" && body !== null && "reason" in body && typeof body.reason === "string") {
        reason = body.reason;
      }
    } catch {
      // Offline or reset connection: the generic message below.
    }
    setError(Object.hasOwn(copy.errors, reason) ? copy.errors[reason as keyof typeof copy.errors] : copy.errors.unexpected);
    setPending(false);
  };

  const idPrefix = `auth-dialog-${mode}`;

  return (
    <dialog
      aria-labelledby={`${idPrefix}-title`}
      className="auth-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) {
          onClose();
        }
      }}
      ref={dialogRef}
    >
      <div className="auth-dialog-card">
        <button aria-label={closeLabel} className="auth-dialog-close" onClick={onClose} title={closeLabel} type="button">
          <svg aria-hidden="true" fill="none" height="16" stroke="currentColor" strokeWidth="1.5" viewBox="0 0 16 16" width="16">
            <path d="M3 3l10 10M13 3L3 13" />
          </svg>
        </button>
        <h2 id={`${idPrefix}-title`}>{text.title}</h2>
        <p className="auth-dialog-lede">{text.description}</p>

        {error ? (
          <p className="auth-error" role="alert">
            {error}
          </p>
        ) : null}

        <form className="auth-form" key={mode} onSubmit={(event) => void submit(event)}>
          <input name="locale" type="hidden" value={locale} />
          <div className="auth-field">
            <label htmlFor={`${idPrefix}-email`}>{copy.fields.email}</label>
            <input autoComplete="email" autoFocus id={`${idPrefix}-email`} name="email" required type="email" />
          </div>
          <div className="auth-field">
            <label htmlFor={`${idPrefix}-password`}>{copy.fields.password}</label>
            <input
              autoComplete={mode === "login" ? "current-password" : "new-password"}
              id={`${idPrefix}-password`}
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>
          {mode === "register" ? (
            <div className="auth-field">
              <label htmlFor={`${idPrefix}-confirmation`}>{copy.fields.passwordConfirmation}</label>
              <input
                autoComplete="new-password"
                id={`${idPrefix}-confirmation`}
                minLength={8}
                name="passwordConfirmation"
                required
                type="password"
              />
            </div>
          ) : null}
          {mode === "register" ? <ConsentLine copy={consentCopy} locale={locale} onFollow={onClose} /> : null}
          <button aria-busy={pending} className="button primary auth-submit" disabled={pending} type="submit">
            {text.submit}
          </button>
        </form>

        <p className="auth-secondary">
          {text.secondaryPrompt}{" "}
          <button
            className="auth-link"
            onClick={() => {
              setError(null);
              onModeChange(otherMode);
            }}
            type="button"
          >
            {text.secondaryAction}
          </button>
        </p>
      </div>
    </dialog>
  );
};
