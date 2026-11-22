import Image from "next/image";

import type { OpportunityWithPreview } from "@/lib/opportunity-preview-assets";

import { ImageryCredit } from "@/components/imagery-credit";
import WatchToggleButton from "@/components/watch-toggle-button";
import type { AppLocale } from "@/i18n/config";
import { fillTemplate, formatLocalizedDate, getIntlLocale } from "@/i18n/format";
import type { DiscoverFeedCopy } from "@/i18n/slices";
import {
  classifyMissingInformation,
  countDeadline,
  humanizeExcerpt,
  isMachineNote,
} from "@/lib/opportunity-detail-model";
import {
  formatTaxonomyList,
  getOpportunityDisplayMeta,
  joinValues,
  truthFlag,
} from "@/lib/opportunity-display";
import { opportunityImageRevision } from "@/lib/opportunity-preview-revision";

type OpportunityDetailBodyProps = {
  copy: DiscoverFeedCopy;
  isWatched: boolean;
  locale: AppLocale;
  now: Date;
  onWatchChange?: (isWatched: boolean) => void;
  opportunity: OpportunityWithPreview;
  /** The sheet opened from list data; the AI overview and excerpts are still on their way. */
  pending?: boolean;
  signedIn: boolean;
};

type Row = { label: string; value: string };

const NOTICE_CATEGORIES = ["timeline", "commercial", "eligibility", "scope", "submission"] as const;

/** A labelled list of stated values. Callers drop unstated rows first, so it never renders empty. */
const RowList = ({ rows }: { rows: readonly Row[] }) => (
  <dl className="detail-list">
    {rows.map((row) => (
      <div className="detail-item" key={row.label}>
        <dt className="detail-label">{row.label}</dt>
        <dd>{row.value}</dd>
      </div>
    ))}
  </dl>
);

const Section = ({ children, title, note }: { children: React.ReactNode; note?: string; title: string }) => (
  <section className="detail-section">
    <h2>{title}</h2>
    {note ? <p className="detail-section-note">{note}</p> : null}
    {children}
  </section>
);

export const OpportunityDetailBody = ({
  copy,
  isWatched,
  locale,
  now,
  onWatchChange,
  opportunity,
  pending = false,
  signedIn,
}: OpportunityDetailBodyProps) => {
  const meta = getOpportunityDisplayMeta(copy, locale, opportunity);
  const { common, detail } = copy;
  const imageUrl = `/api/opportunities/${opportunity.slug}/image?rev=${opportunityImageRevision}`;
  const isZh = locale === "zh";
  const assessment = opportunity.aiAssessment;
  const hasValue = opportunity.estimatedContractValueEur !== null || Boolean(opportunity.estimatedContractValueText);

  const { geoLat, geoLng, geoSource } = opportunity;
  const hasCoordinates =
    geoLat !== null && geoLng !== null && Number.isFinite(geoLat) && Number.isFinite(geoLng) &&
    Math.abs(geoLat) <= 90 && Math.abs(geoLng) <= 180;
  const mapZoom = geoSource?.endsWith(":country") ? 5 : geoSource?.endsWith(":area") ? 10 : 12;
  const mapUrl = hasCoordinates
    ? `https://www.openstreetmap.org/?mlat=${geoLat}&mlon=${geoLng}#map=${mapZoom}/${geoLat}/${geoLng}`
    : null;

  const countdown = countDeadline(opportunity.deadlineAt, now);
  const countdownLabel = !countdown
    ? null
    : countdown.kind === "daysLeft"
      ? fillTemplate(detail.deadline.daysLeft, { days: countdown.days })
      : countdown.kind === "dueToday"
        ? detail.deadline.dueToday
        : detail.deadline.closed;

  const facts: Row[] = [
    { label: detail.facts.deadline, value: meta.deadlineValueLabel },
    { label: detail.facts.value, value: meta.valueLabel },
    { label: detail.facts.location, value: meta.locationLabel },
    { label: detail.facts.authority, value: meta.authorityLabel },
  ];

  const summary = assessment ? (isZh ? assessment.summaryZh : assessment.summaryEn) : "";
  const reasons = assessment ? (isZh ? assessment.reasonsZh : assessment.reasonsEn) : [];

  const excerpts = NOTICE_CATEGORIES.map((category) => ({
    category,
    items: (opportunity.noticeDetails ?? []).filter((item) => item.category === category),
  })).filter((group) => group.items.length > 0);

  // Only what the notice states. Unknowns are collected once, in the "not found" list.
  const conditionRows: Row[] = [];
  if (opportunity.licensedArchitectRequired !== null) {
    conditionRows.push({
      label: detail.requirements.architect,
      value: opportunity.licensedArchitectRequired ? common.explicitRequired : common.notExplicitInNotice,
    });
  }
  if (opportunity.localPartnerRequired !== null) {
    conditionRows.push({
      label: detail.requirements.localPartner,
      value: truthFlag(copy, opportunity.localPartnerRequired, common.likelyRequired, common.notSignaledInNotice),
    });
  }
  const feeStated = opportunity.registrationFeeEur !== null || opportunity.submissionFeeEur !== null;
  if (feeStated) {
    conditionRows.push({ label: detail.requirements.cost, value: meta.participationCostLabel });
  }
  if (opportunity.prizeSummary) {
    conditionRows.push({ label: detail.requirements.prize, value: opportunity.prizeSummary });
  }
  // The eligibility sentence is often the same text as an eligibility excerpt; show it once.
  const excerptTexts = (opportunity.noticeDetails ?? []).map((item) => item.text);
  if (
    opportunity.eligibilitySummary &&
    !excerptTexts.some((text) => text.includes(opportunity.eligibilitySummary) || opportunity.eligibilitySummary.includes(text))
  ) {
    conditionRows.push({ label: detail.requirements.eligibility, value: opportunity.eligibilitySummary });
  }

  // The model's list can name things the record already holds; those are not "missing".
  const alreadyKnown = new Set<string>();
  if (opportunity.deadlineAt) alreadyKnown.add("deadline");
  if (hasValue) alreadyKnown.add("value");
  if (opportunity.authorityName.trim()) alreadyKnown.add("buyer");
  if (feeStated) alreadyKnown.add("fees");
  if (opportunity.licensedArchitectRequired !== null) alreadyKnown.add("qualification");
  if (opportunity.localPartnerRequired !== null) alreadyKnown.add("localPartner");
  if (opportunity.documentsPortalUrl || opportunity.briefPdfUrl) alreadyKnown.add("documents");
  const missing = classifyMissingInformation(assessment?.missingInformation ?? []).filter(
    (topic) => !alreadyKnown.has(topic),
  );

  const typeChips = [
    meta.cardCategoryLabel,
    ...formatTaxonomyList(copy, "builtAssetTypes", opportunity.builtAssetTypes).split(" · "),
    ...formatTaxonomyList(copy, "designScopes", opportunity.designScopes).split(" · "),
    ...formatTaxonomyList(copy, "projectModes", opportunity.projectModes).split(" · "),
  ].filter((chip, index, all) => chip && chip !== common.unstated && all.indexOf(chip) === index);

  const mapPrecision = !hasCoordinates
    ? null
    : geoSource?.endsWith(":country")
      ? detail.source.countryLocation
      : geoSource?.endsWith(":area")
        ? detail.source.areaLocation
        : detail.source.mappedLocation;
  const sourceRows: Row[] = [
    { label: detail.source.opportunityType, value: meta.opportunityTypeLabel },
    { label: detail.source.procedure, value: opportunity.procedureTypeKey ? meta.procedureLabel : "" },
    { label: detail.source.route, value: opportunity.implementationPathKey ? meta.implementationPathLabel : "" },
    { label: detail.source.noticeId, value: opportunity.officialNoticeId ?? "" },
    {
      label: detail.source.sourceKind,
      value: opportunity.evidenceLevelKey.startsWith("official") ? common.primaryOfficialSource : common.secondarySource,
    },
    { label: detail.source.discovered, value: formatLocalizedDate(locale, opportunity.discoveredAt) ?? "" },
    { label: detail.source.languages, value: joinValues(opportunity.languages, (value) => value.toUpperCase(), "") },
    { label: detail.source.cpv, value: joinValues(opportunity.cpvCodes, (value) => value, "") },
    { label: detail.source.locationPrecision, value: mapPrecision ?? "" },
    { label: detail.source.note, value: opportunity.evidenceNote && !isMachineNote(opportunity.evidenceNote) ? opportunity.evidenceNote : "" },
  ].filter((row) => row.value !== "" && row.value !== common.unstated);

  const intlLocale = getIntlLocale(locale);
  const links = [
    meta.officialPageLink ? { href: meta.officialPageLink, label: common.officialPage, primary: true } : null,
    meta.documentsPortalLink ? { href: meta.documentsPortalLink, label: common.documentsPortal, primary: false } : null,
    opportunity.briefPdfUrl ? { href: opportunity.briefPdfUrl, label: common.briefPdf, primary: false } : null,
    meta.sourceTraceLink ? { href: meta.sourceTraceLink, label: common.sourceTrace, primary: false } : null,
    mapUrl ? { href: mapUrl, label: detail.openMap, primary: false } : null,
  ].filter((link): link is { href: string; label: string; primary: boolean } => link !== null);

  return (
    <article className="detail-body">
      <header className="detail-head">
        <div className="detail-media">
          <Image
            alt=""
            fill
            sizes="(max-width: 960px) 100vw, 880px"
            src={opportunity.preview ? opportunity.preview.image ?? opportunity.preview.locator : imageUrl}
            unoptimized
          />
          {opportunity.preview
            ? opportunity.preview.attribution && <p className="imagery-credit">{opportunity.preview.attribution}</p>
            : <ImageryCredit url={imageUrl} />}
        </div>
        <div className="detail-head-copy">
          <p className="detail-kicker">
            {assessment ? (
              <span className={`pill${assessment.decision === "recommend" ? " accent" : ""}`}>
                {detail.verdict[assessment.decision]}
              </span>
            ) : null}
            <span>{meta.cardCategoryLabel}</span>
          </p>
          <h1>{meta.displayTitle}</h1>
          {meta.displayTitle !== opportunity.title ? (
            <p className="detail-original-title">
              <span className="detail-label">{detail.originalTitle}</span> {opportunity.title}
            </p>
          ) : null}
        </div>
      </header>

      <dl className="detail-facts">
        {facts.map((row) => (
          <div className="detail-fact" key={row.label}>
            <dt className="detail-label">{row.label}</dt>
            <dd>
              {row.value}
              {row.label === detail.facts.deadline && countdownLabel ? (
                <span className={`detail-countdown${countdown?.kind === "closed" ? " is-closed" : ""}`}>
                  {countdownLabel}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>

      <div className="detail-actions">
        {links.map((link) => (
          <a
            className={`button ${link.primary ? "primary" : "secondary"}`}
            href={link.href}
            key={link.href}
            rel="noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
        <WatchToggleButton
          copy={copy}
          initialWatched={isWatched}
          locale={locale}
          onToggle={onWatchChange}
          opportunityId={opportunity.id}
          showStatus
          signedIn={signedIn}
        />
      </div>

      {pending ? (
        <div aria-busy="true" className="detail-skeleton-lines" role="status">
          <span className="sr-only">{detail.drawer.loading}</span>
          <span style={{ width: "92%" }} />
          <span style={{ width: "86%" }} />
          <span style={{ width: "60%" }} />
        </div>
      ) : null}

      {summary ? (
        <Section note={detail.summary.aiNote} title={detail.summary.title}>
          <p className="detail-summary-text">{summary}</p>
          {reasons.length > 0 ? (
            <>
              <h3 className="detail-subheading">{detail.summary.reasons}</h3>
              <ul className="detail-reasons">
                {reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            </>
          ) : null}
        </Section>
      ) : null}

      {excerpts.length > 0 ? (
        <Section note={detail.participation.note} title={detail.participation.title}>
          <dl className="detail-list">
            {excerpts.map((group) => (
              <div className="detail-item" key={group.category}>
                <dt className="detail-label">{detail.participation.categories[group.category]}</dt>
                {group.items.map((item) => (
                  <dd key={item.text}>{humanizeExcerpt(item.text, intlLocale)}</dd>
                ))}
              </div>
            ))}
          </dl>
        </Section>
      ) : null}

      {conditionRows.length > 0 ? (
        <Section title={detail.requirements.title}>
          <RowList rows={conditionRows} />
        </Section>
      ) : null}

      {missing.length > 0 ? (
        <Section note={detail.missing.note} title={detail.missing.title}>
          <ul className="detail-chips">
            {missing.map((topic) => (
              <li key={topic}>{detail.missing.items[topic]}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {typeChips.length > 0 ? (
        <Section title={detail.classification.title}>
          <ul className="detail-chips">
            {typeChips.map((chip) => (
              <li key={chip}>{chip}</li>
            ))}
          </ul>
        </Section>
      ) : null}

      {sourceRows.length > 0 ? (
        <details className="detail-source">
          <summary>{detail.source.title}</summary>
          <RowList rows={sourceRows} />
        </details>
      ) : null}
    </article>
  );
};
