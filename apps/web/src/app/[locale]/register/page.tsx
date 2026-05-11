import Link from "next/link";

import { buildLocalePath } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import type { AppDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

type AuthSearchParams = Record<string, string | string[] | undefined>;

type LocalizedRegisterPageProps = {
  params: Promise<{ locale: string }>;
  searchParams: Promise<AuthSearchParams>;
};

const readSearchValue = (searchParams: AuthSearchParams, key: string) => {
  const value = searchParams[key];
  return Array.isArray(value) ? value[0] ?? "" : value ?? "";
};

const resolveErrorMessage = (dictionary: AppDictionary, error: string) => {
  if (!error) {
    return null;
  }

  return Object.prototype.hasOwnProperty.call(dictionary.auth.errors, error)
    ? dictionary.auth.errors[error as keyof AppDictionary["auth"]["errors"]]
    : dictionary.auth.errors.unexpected;
};

const LocalizedRegisterPage = async ({
  params,
  searchParams,
}: LocalizedRegisterPageProps) => {
  const { locale: rawLocale } = await params;
  const locale = resolveLocaleOrNotFound(rawLocale);
  const dictionary = getDictionary(locale);
  const resolvedSearchParams = await searchParams;
  const errorMessage = resolveErrorMessage(
    dictionary,
    readSearchValue(resolvedSearchParams, "error"),
  );
  const email = readSearchValue(resolvedSearchParams, "email");

  return (
    <main className="auth-page">
      <section className="auth-panel">
        <span className="eyebrow">{dictionary.auth.register.eyebrow}</span>
        <h1>{dictionary.auth.register.title}</h1>
        <p>{dictionary.auth.register.description}</p>

        {errorMessage ? (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form action="/api/auth/register" className="auth-form" method="post">
          <input name="locale" type="hidden" value={locale} />
          <div className="auth-field">
            <label htmlFor="register-email">{dictionary.auth.fields.email}</label>
            <input
              autoComplete="email"
              defaultValue={email}
              id="register-email"
              name="email"
              required
              type="email"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-password">{dictionary.auth.fields.password}</label>
            <input
              autoComplete="new-password"
              id="register-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="register-password-confirmation">
              {dictionary.auth.fields.passwordConfirmation}
            </label>
            <input
              autoComplete="new-password"
              id="register-password-confirmation"
              minLength={8}
              name="passwordConfirmation"
              required
              type="password"
            />
          </div>
          <button className="button primary auth-submit" type="submit">
            {dictionary.auth.register.submit}
          </button>
        </form>

        <p className="auth-secondary">
          {dictionary.auth.register.secondaryPrompt}{" "}
          <Link className="auth-link" href={buildLocalePath(locale, "/login")}>
            {dictionary.auth.register.secondaryAction}
          </Link>
        </p>
      </section>
    </main>
  );
};

export default LocalizedRegisterPage;
