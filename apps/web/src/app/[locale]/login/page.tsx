import Link from "next/link";

import { buildLocalePath } from "@/i18n/config";
import { getDictionary, resolveLocaleOrNotFound } from "@/i18n/server";
import type { AppDictionary } from "@/i18n/dictionaries";

export const dynamic = "force-dynamic";

type AuthSearchParams = Record<string, string | string[] | undefined>;

type LocalizedLoginPageProps = {
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

const LocalizedLoginPage = async ({ params, searchParams }: LocalizedLoginPageProps) => {
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
        <span className="eyebrow">{dictionary.auth.login.eyebrow}</span>
        <h1>{dictionary.auth.login.title}</h1>
        <p>{dictionary.auth.login.description}</p>

        {errorMessage ? (
          <p className="auth-error" role="alert">
            {errorMessage}
          </p>
        ) : null}

        <form action="/api/auth/login" className="auth-form" method="post">
          <input name="locale" type="hidden" value={locale} />
          <div className="auth-field">
            <label htmlFor="login-email">{dictionary.auth.fields.email}</label>
            <input
              autoComplete="email"
              defaultValue={email}
              id="login-email"
              name="email"
              required
              type="email"
            />
          </div>
          <div className="auth-field">
            <label htmlFor="login-password">{dictionary.auth.fields.password}</label>
            <input
              autoComplete="current-password"
              id="login-password"
              minLength={8}
              name="password"
              required
              type="password"
            />
          </div>
          <button className="button primary auth-submit" type="submit">
            {dictionary.auth.login.submit}
          </button>
        </form>

        <p className="auth-secondary">
          {dictionary.auth.login.secondaryPrompt}{" "}
          <Link className="auth-link" href={buildLocalePath(locale, "/register")}>
            {dictionary.auth.login.secondaryAction}
          </Link>
        </p>
      </section>
    </main>
  );
};

export default LocalizedLoginPage;
