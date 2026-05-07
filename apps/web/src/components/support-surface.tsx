import Link from "next/link";

import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";

type SupportSurfaceProps = {
  dictionary: AppDictionary;
  locale: AppLocale;
};

export const SupportSurface = ({ dictionary, locale }: SupportSurfaceProps) => {
  const copy = dictionary.support;

  return (
    <main className="support-page">
      <section className="support-stage support-hero">
        <div className="support-hero-copy">
          <span className="eyebrow">{copy.heroEyebrow}</span>
          <h1>{copy.heroTitle}</h1>
          <p className="support-lead">{copy.heroIntro}</p>
          <div className="hero-actions">
            <a className="button secondary" href="#support-tracks">
              {copy.heroActions.primary}
            </a>
            <Link className="button primary" href={buildLocalePath(locale, "/discover")}>
              {copy.heroActions.secondary}
            </Link>
          </div>
        </div>

        <aside className="support-principles">
          <dl className="support-principle-list">
            {copy.principles.items.map((item) => (
              <div key={item.label} className="support-principle-item">
                <dt>{item.label}</dt>
                <dd>{item.value}</dd>
              </div>
            ))}
          </dl>
        </aside>
      </section>

      <section className="support-stage support-rationale">
        <div className="support-section-head">
          <span className="section-kicker">{copy.rationale.eyebrow}</span>
          <h2>{copy.rationale.title}</h2>
        </div>

        <div className="support-rationale-grid">
          <p className="support-body">{copy.rationale.body}</p>
          <div className="support-point-grid">
            {copy.rationale.points.map((point) => (
              <p key={point} className="support-point">
                {point}
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="support-stage support-tracks" id="support-tracks">
        <div className="support-section-head">
          <span className="section-kicker">{copy.tracks.eyebrow}</span>
          <h2>{copy.tracks.title}</h2>
          <p className="support-body support-intro">{copy.tracks.intro}</p>
        </div>

        <div className="support-track-grid">
          {copy.tracks.items.map((item, index) => (
            <article key={item.title} className="support-track">
              <div className="support-track-topline">
                <span className="sheet-index">{String(index + 1).padStart(2, "0")}</span>
                <span className="section-kicker">{item.eyebrow}</span>
              </div>
              <h3>{item.title}</h3>
              <p className="support-body">{item.summary}</p>
              <ul className="support-track-list">
                {item.points.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
              <p className="support-track-note">{item.note}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="support-stage support-roadmap">
        <div className="support-section-head">
          <span className="section-kicker">{copy.roadmap.eyebrow}</span>
          <h2>{copy.roadmap.title}</h2>
        </div>

        <div className="support-roadmap-grid">
          {copy.roadmap.items.map((item) => (
            <article key={item.label} className="support-roadmap-item">
              <span className="band-label">{item.label}</span>
              <p>{item.value}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="support-stage support-closing">
        <div className="support-section-head">
          <span className="section-kicker">{copy.closing.eyebrow}</span>
          <h2>{copy.closing.title}</h2>
        </div>

        <div className="support-closing-body">
          <p className="support-body">{copy.closing.body}</p>
          <p className="support-disclaimer">{copy.closing.disclaimer}</p>
          <div className="hero-actions">
            <a className="button secondary" href="#support-tracks">
              {copy.closing.primary}
            </a>
            <Link className="button primary" href={buildLocalePath(locale, "/discover")}>
              {copy.closing.secondary}
            </Link>
          </div>
        </div>
      </section>
    </main>
  );
};
