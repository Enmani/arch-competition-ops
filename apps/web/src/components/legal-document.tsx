import type { ReactNode } from "react";

export type LegalDocumentSection = {
  /** Extra content after the text (a table, a list of links); rendered as given. */
  extra?: ReactNode;
  heading: string;
  id: string;
  items: readonly string[];
  paragraphs: readonly string[];
};

type LegalDocumentProps = {
  lede: string;
  sections: readonly LegalDocumentSection[];
  title: string;
  tocLabel: string;
  /** The formatted "last updated" line; omitted on pages without one. */
  updated?: string;
};

/** Pages with this many sections or more get a short table of contents under the title. */
const TOC_MIN_SECTIONS = 8;

/**
 * One reading column for long text pages (Terms, Privacy, Refund, About): title, lede, an
 * optional date line and contents list, then sections of paragraphs and bullets.
 * Copy arrives already localised and filled; this component only lays it out.
 */
export const LegalDocument = ({ lede, sections, title, tocLabel, updated }: LegalDocumentProps) => (
  <main className="legal-page">
    <header className="legal-intro">
      <h1>{title}</h1>
      <p className="legal-lede">{lede}</p>
      {updated ? <p className="legal-updated">{updated}</p> : null}
    </header>

    {sections.length >= TOC_MIN_SECTIONS ? (
      <nav aria-label={tocLabel} className="legal-toc">
        <p className="legal-toc-label">{tocLabel}</p>
        <ol>
          {sections.map((section) => (
            <li key={section.id}>
              <a href={`#${section.id}`}>{section.heading}</a>
            </li>
          ))}
        </ol>
      </nav>
    ) : null}

    {sections.map((section) => (
      <section aria-labelledby={`${section.id}-heading`} className="legal-section" id={section.id} key={section.id}>
        <h2 id={`${section.id}-heading`}>{section.heading}</h2>
        {section.paragraphs.map((paragraph) => (
          <p key={paragraph}>{paragraph}</p>
        ))}
        {section.items.length > 0 ? (
          <ul>
            {section.items.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        ) : null}
        {section.extra}
      </section>
    ))}
  </main>
);
