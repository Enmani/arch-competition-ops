import Link from "next/link";

import type { StoredOpportunityFeedItem } from "@arch-competition/storage/cloudflare";

import WatchToggleButton from "@/components/watch-toggle-button";
import { buildLocalePath, type AppLocale } from "@/i18n/config";
import type { AppDictionary } from "@/i18n/dictionaries";
import {
  formatAudienceLabel,
  formatBuiltAssetTypesLabel,
  formatCompetitionTagsLabel,
  formatDesignScopesLabel,
  formatOfficialSectorsLabel,
  formatProjectModesLabel,
  formatRegionsLabel,
  getOpportunityDisplayMeta,
  joinValues,
  truthFlag,
} from "@/lib/opportunity-display";

type OpportunityDetailSurfaceProps = {
  dictionary: AppDictionary;
  isWatched: boolean;
  locale: AppLocale;
  opportunity: StoredOpportunityFeedItem;
  workspaceWritesEnabled: boolean;
};

export const OpportunityDetailSurface = ({
  dictionary,
  isWatched,
  locale,
  opportunity,
  workspaceWritesEnabled,
}: OpportunityDetailSurfaceProps) => {
  const {
    deadlineLabel,
    discoveryTrail,
    documentsPortalLink,
    evidenceLevelLabel,
    implementationPathLabel,
    locationLabel,
    officialPageLink,
    opportunityTypeLabel,
    participationCostLabel,
    procedureLabel,
    cardCategoryLabel,
    sourceTraceLink,
    statusLabel,
    valueLabel,
  } = getOpportunityDisplayMeta(dictionary, locale, opportunity);
  const qualificationLabel =
    opportunity.licensedArchitectRequired === true
      ? dictionary.common.explicitRequired
      : opportunity.licensedArchitectRequired === false
        ? dictionary.common.notExplicitInNotice
        : dictionary.common.unstated;
  const description =
    locale === "zh"
      ? `${dictionary.detail.fields.implementationRoute}：${implementationPathLabel} · ${dictionary.feed.fields.evidenceStack}：${evidenceLevelLabel}`
      : `${dictionary.detail.fields.implementationRoute}: ${implementationPathLabel} · ${dictionary.feed.fields.evidenceStack}: ${evidenceLevelLabel}`;

  return (
    <main className="detail-layout">
      <section className="detail-hero">
        <span className="eyebrow">{dictionary.detail.eyebrow}</span>
        <h1>{opportunity.title}</h1>
        <p>{description}</p>
        <div className="tag-row">
          <span className="pill accent">{statusLabel}</span>
          <span className="pill">{locationLabel}</span>
          <span className="pill">{deadlineLabel}</span>
        </div>
        <div className="detail-hero-actions">
          <WatchToggleButton
            initialWatched={isWatched}
            opportunityId={opportunity.id}
            showStatus
            workspaceDictionary={dictionary.workspace}
            workspaceWritesEnabled={workspaceWritesEnabled}
          />
        </div>
      </section>

      <div className="detail-grid">
        <div className="detail-stack">
          <section className="detail-section detail-section-anchored">
            <h2>{dictionary.detail.keyFacts}</h2>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.authority}</span>
                <span>{opportunity.authorityName}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.discover.card.location}</span>
                <span>{locationLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.opportunityType}</span>
                <span>{opportunityTypeLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.projectCategory}</span>
                <span>{cardCategoryLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.procedure}</span>
                <span>{procedureLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.implementationRoute}</span>
                <span>{implementationPathLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.eligibility}</span>
                <span>{opportunity.eligibilitySummary || dictionary.common.unstated}</span>
              </div>
            </div>
          </section>

          <section className="detail-section detail-section-anchored">
            <h2>{dictionary.feed.sections.commercial}</h2>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.commercialSignal}</span>
                <span>{valueLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.participationCost}</span>
                <span>{participationCostLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.prizeNote}</span>
                <span>{opportunity.prizeSummary ?? dictionary.common.unstated}</span>
              </div>
            </div>
          </section>

          <section className="detail-section detail-section-anchored">
            <h2>{dictionary.feed.sections.qualification}</h2>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.qualification}</span>
                <span>{qualificationLabel}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.localPartner}</span>
                <span>
                  {truthFlag(
                    dictionary,
                    opportunity.localPartnerRequired,
                    dictionary.common.likelyRequired,
                    dictionary.common.notSignaledInNotice,
                  )}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.qualificationScore}</span>
                <span>
                  {opportunity.qualificationScore !== null
                    ? opportunity.qualificationScore.toFixed(2)
                    : dictionary.common.unscored}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.audience}</span>
                <span>{formatAudienceLabel(dictionary, opportunity)}</span>
              </div>
            </div>
          </section>
        </div>

        <div className="detail-stack">
          <section className="detail-section detail-section-anchored">
            <h2>{dictionary.feed.sections.trace}</h2>
            <div className="detail-list">
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.noticeId}</span>
                <span>{opportunity.officialNoticeId ?? dictionary.common.unstated}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.evidenceStack}</span>
                <span>{`${opportunity.evidenceLevelKey.startsWith("official") ? dictionary.common.primaryOfficialSource : dictionary.common.secondarySource} · ${evidenceLevelLabel}`}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.discoveryTrail}</span>
                <span>{discoveryTrail}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.extractionConfidence}</span>
                <span>{`${Math.round(opportunity.extractionConfidence * 100)}%`}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.languages}</span>
                <span>
                  {joinValues(
                    opportunity.languages,
                    (value) => value.toUpperCase(),
                    dictionary.common.unstated,
                  )}
                </span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.regions}</span>
                <span>{formatRegionsLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.competitionTags}</span>
                <span>{formatCompetitionTagsLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.officialSectors}</span>
                <span>{formatOfficialSectorsLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.builtAssetTypes}</span>
                <span>{formatBuiltAssetTypesLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.designScopes}</span>
                <span>{formatDesignScopesLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.detail.fields.projectModes}</span>
                <span>{formatProjectModesLabel(dictionary, opportunity)}</span>
              </div>
              <div className="detail-item">
                <span className="detail-label">{dictionary.feed.fields.cpv}</span>
                <span>{joinValues(opportunity.cpvCodes, (value) => value, dictionary.common.unstated)}</span>
              </div>
            </div>
          </section>

          <section className="detail-section detail-section-anchored">
            <h2>{dictionary.detail.evidenceActions}</h2>
            <div className="card-grid detail-card-grid">
              <article className="competition-card detail-note-card">
                <span className="detail-label">{dictionary.detail.sourceNote}</span>
                <p className="detail-note-text">{opportunity.evidenceNote || dictionary.common.unstated}</p>
              </article>
              <article className="competition-card detail-note-card">
                <span className="detail-label">{dictionary.detail.links}</span>
                <div className="hero-actions">
                  {officialPageLink ? (
                    <a
                      className="button primary"
                      href={officialPageLink}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {dictionary.common.officialPage}
                    </a>
                  ) : null}
                  {opportunity.briefPdfUrl ? (
                    <a
                      className="button secondary"
                      href={opportunity.briefPdfUrl}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {dictionary.common.briefPdf}
                    </a>
                  ) : null}
                  {documentsPortalLink ? (
                    <a
                      className="button secondary"
                      href={documentsPortalLink}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {dictionary.common.documentsPortal}
                    </a>
                  ) : null}
                  {sourceTraceLink ? (
                    <a
                      className="button secondary"
                      href={sourceTraceLink}
                      rel="noreferrer"
                      target="_blank"
                    >
                      {dictionary.common.sourceTrace}
                    </a>
                  ) : null}
                  <Link className="button secondary" href={buildLocalePath(locale, "/discover")}>
                    {dictionary.common.backToRadar}
                  </Link>
                </div>
              </article>
            </div>
          </section>
        </div>
      </div>
    </main>
  );
};
