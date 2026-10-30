import Link from "next/link";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import { pickWatchToggleCopy } from "@/i18n/slices";
import {
  formatTaxonomyList,
  getOpportunityDisplayMeta,
  joinValues,
  truthFlag,
} from "@/lib/opportunity-display";

type OpportunityDetailSurfaceProps = {
  dictionary: AppDictionary;
  isWatched: boolean;
  locale: AppLocale;
  opportunity: StoredOpportunityFeedItem;
  signedIn: boolean;
};

type DetailRow = { label: string; value: string };

type DetailSectionProps = { rows: readonly DetailRow[]; title: string };

/** A titled list of stated facts. The caller drops unstated rows first, so this never renders an empty shell. */
const DetailSection = ({ rows, title }: DetailSectionProps) =>
  rows.length === 0 ? null : (
    <section className="detail-section">
      <h2>{title}</h2>
      <dl className="detail-list">
        {rows.map((row) => (
          <div className="detail-item" key={row.label}>
            <dt className="detail-label">{row.label}</dt>
            <dd>{row.value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );

export const OpportunityDetailSurface = ({
  dictionary,
  isWatched,
  locale,
  opportunity,
  signedIn,
}: OpportunityDetailSurfaceProps) => {
  const {
    authorityLabel,
    cardCategoryLabel,
    deadlineValueLabel,
    discoveryTrail,
    documentsPortalLink,
    evidenceLevelLabel,
    implementationPathLabel,
    locationLabel,
    officialPageLink,
    opportunityTypeLabel,
    participationCostLabel,
    procedureLabel,
    sourceTraceLink,
    statusLabel,
    valueLabel,
  } = getOpportunityDisplayMeta(dictionary, locale, opportunity);
  const { unscored, unstated } = dictionary.common;
  const qualificationLabel =
    opportunity.licensedArchitectRequired === true
      ? dictionary.common.explicitRequired
      : opportunity.licensedArchitectRequired === false
        ? dictionary.common.notExplicitInNotice
        : unstated;

  const factRows: DetailRow[] = [
    { label: dictionary.detail.fields.opportunityType, value: opportunityTypeLabel },
    { label: dictionary.detail.fields.projectCategory, value: cardCategoryLabel },
    { label: dictionary.detail.fields.procedure, value: procedureLabel },
    { label: dictionary.detail.fields.implementationRoute, value: implementationPathLabel },
    { label: dictionary.detail.fields.eligibility, value: opportunity.eligibilitySummary || unstated },
  ];
  const commercialRows: DetailRow[] = [
    { label: dictionary.feed.fields.participationCost, value: participationCostLabel },
    { label: dictionary.feed.fields.prizeNote, value: opportunity.prizeSummary ?? unstated },
  ];
  const qualificationRows: DetailRow[] = [
    { label: dictionary.detail.fields.qualification, value: qualificationLabel },
    {
      label: dictionary.feed.fields.localPartner,
      value: truthFlag(
        dictionary,
        opportunity.localPartnerRequired,
        dictionary.common.likelyRequired,
        dictionary.common.notSignaledInNotice,
      ),
    },
    {
      label: dictionary.feed.fields.qualificationScore,
      value: opportunity.qualificationScore !== null ? opportunity.qualificationScore.toFixed(2) : unscored,
    },
    {
      label: dictionary.feed.fields.audience,
      value: formatTaxonomyList(dictionary, "audiences", opportunity.audience),
    },
  ];
  const traceRows: DetailRow[] = [
    { label: dictionary.feed.fields.noticeId, value: opportunity.officialNoticeId ?? unstated },
    {
      label: dictionary.feed.fields.evidenceStack,
      value: `${opportunity.evidenceLevelKey.startsWith("official") ? dictionary.common.primaryOfficialSource : dictionary.common.secondarySource} · ${evidenceLevelLabel}`,
    },
    { label: dictionary.feed.fields.discoveryTrail, value: discoveryTrail },
    {
      label: dictionary.feed.fields.extractionConfidence,
      value: `${Math.round(opportunity.extractionConfidence * 100)}%`,
    },
    {
      label: dictionary.feed.fields.languages,
      value: joinValues(opportunity.languages, (value) => value.toUpperCase(), unstated),
    },
    { label: dictionary.feed.fields.regions, value: formatTaxonomyList(dictionary, "regions", opportunity.regions) },
    {
      label: dictionary.feed.fields.competitionTags,
      value: formatTaxonomyList(dictionary, "competitionTags", opportunity.competitionTypes),
    },
    {
      label: dictionary.detail.fields.officialSectors,
      value: formatTaxonomyList(dictionary, "officialSectors", opportunity.officialSectors),
    },
    {
      label: dictionary.detail.fields.builtAssetTypes,
      value: formatTaxonomyList(dictionary, "builtAssetTypes", opportunity.builtAssetTypes),
    },
    {
      label: dictionary.detail.fields.designScopes,
      value: formatTaxonomyList(dictionary, "designScopes", opportunity.designScopes),
    },
    {
      label: dictionary.detail.fields.projectModes,
      value: formatTaxonomyList(dictionary, "projectModes", opportunity.projectModes),
    },
    { label: dictionary.feed.fields.cpv, value: joinValues(opportunity.cpvCodes, (value) => value, unstated) },
  ];

  // Empty fields are listed once at the end instead of taking a row each.
  const isStated = (row: DetailRow) => row.value !== unstated && row.value !== unscored;
  const sections = [
    { rows: factRows, title: dictionary.detail.keyFacts },
    { rows: commercialRows, title: dictionary.feed.sections.commercial },
    { rows: qualificationRows, title: dictionary.feed.sections.qualification },
    { rows: traceRows, title: dictionary.feed.sections.trace },
  ];
  const missingLabels = sections.flatMap((section) => section.rows.filter((row) => !isStated(row)).map((row) => row.label));
  const [facts, commercial, qualification, trace] = sections.map((section) => (
    <DetailSection key={section.title} rows={section.rows.filter(isStated)} title={section.title} />
  ));

  const summary: DetailRow[] = [
    { label: dictionary.detail.fields.authority, value: authorityLabel },
    { label: dictionary.discover.card.location, value: locationLabel },
    { label: dictionary.discover.card.deadline, value: deadlineValueLabel },
    { label: dictionary.detail.fields.commercialSignal, value: valueLabel },
  ];

  return (
    <main className="detail-layout">
      <section className="detail-hero">
        <span className="pill accent">{statusLabel}</span>
        <h1>{opportunity.title}</h1>
        <dl className="detail-summary">
          {summary.map((row) => (
            <div className="detail-summary-item" key={row.label}>
              <dt className="detail-label">{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <div className="detail-hero-actions">
          {officialPageLink ? (
            <a className="button primary" href={officialPageLink} rel="noreferrer" target="_blank">
              {dictionary.common.officialPage}
            </a>
          ) : null}
          <WatchToggleButton
            copy={pickWatchToggleCopy(dictionary)}
            initialWatched={isWatched}
            locale={locale}
            opportunityId={opportunity.id}
            showStatus
            signedIn={signedIn}
          />
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-stack">
          {facts}
          {commercial}
          {qualification}
          {opportunity.noticeDetails?.length ? (
            <section className="detail-section">
              <h2>{dictionary.detail.noticeDetails}</h2>
              <p>{dictionary.detail.noticeDetailsNote}</p>
              <dl className="detail-list">
                {opportunity.noticeDetails.map((detail, index) => (
                  <div className="detail-item" key={`${detail.category}-${index}`}>
                    <dt className="detail-label">{dictionary.detail.noticeDetailCategories[detail.category]}</dt>
                    <dd>{detail.text}</dd>
                  </div>
                ))}
              </dl>
            </section>
          ) : null}
        </div>

        <div className="detail-stack">
          {trace}

          <section className="detail-section">
            <h2>{dictionary.detail.evidenceActions}</h2>
            {opportunity.evidenceNote ? (
              <div className="detail-note">
                <span className="detail-label">{dictionary.detail.sourceNote}</span>
                <p className="detail-note-text">{opportunity.evidenceNote}</p>
              </div>
            ) : null}
            <div className="hero-actions detail-links">
              {opportunity.briefPdfUrl ? (
                <a className="button secondary" href={opportunity.briefPdfUrl} rel="noreferrer" target="_blank">
                  {dictionary.common.briefPdf}
                </a>
              ) : null}
              {documentsPortalLink ? (
                <a className="button secondary" href={documentsPortalLink} rel="noreferrer" target="_blank">
                  {dictionary.common.documentsPortal}
                </a>
              ) : null}
              {sourceTraceLink ? (
                <a className="button secondary" href={sourceTraceLink} rel="noreferrer" target="_blank">
                  {dictionary.common.sourceTrace}
                </a>
              ) : null}
              <Link className="button secondary" href={buildLocalePath(locale, "/discover")}>
                {dictionary.common.backToRadar}
              </Link>
            </div>
          </section>
        </div>
      </div>

      {missingLabels.length > 0 ? (
        <p className="detail-missing">
          <span className="detail-label">{unstated}</span> {missingLabels.join(" · ")}
        </p>
      ) : null}
    </main>
  );
};
