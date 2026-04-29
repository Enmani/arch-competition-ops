import Link from "next/link";

import type { ProfessionalOpportunity } from "@arch-competition/core";

type CompetitionCardProps = {
  competition: ProfessionalOpportunity;
};

export const CompetitionCard = ({ competition }: CompetitionCardProps) => {
  return (
    <article className="competition-card">
      <div className="card-meta">
        <span className="pill accent">{competition.statusLabel}</span>
        <span className="pill">{competition.jurisdictionLabel}</span>
        <span className="pill">{competition.deadlineLabel}</span>
      </div>
      <div>
        <h3>{competition.title}</h3>
        <p>{competition.subtitle}</p>
      </div>
      <div className="inline-metrics">
        <div className="metric-card">
          <span className="detail-label">Authority</span>
          <span className="metric-value">{competition.authorityName}</span>
        </div>
        <div className="metric-card">
          <span className="detail-label">Value</span>
          <span className="metric-value">{competition.contractValueLabel}</span>
        </div>
      </div>
      <div className="tag-row">
        <span className="pill">{competition.opportunityTypeLabel}</span>
        <span className="pill">{competition.procedureTypeLabel}</span>
        {competition.tags.map((tag) => (
          <span key={tag} className="pill">
            {tag}
          </span>
        ))}
      </div>
      <Link className="button secondary" href={`/opportunities/${competition.slug}`}>
        Open opportunity
      </Link>
    </article>
  );
};
