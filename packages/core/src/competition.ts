import { z } from "zod";

export const professionalOpportunitySchema = z.object({
  id: z.string(),
  slug: z.string(),
  title: z.string(),
  subtitle: z.string(),
  authorityName: z.string(),
  jurisdictionLabel: z.string(),
  opportunityTypeLabel: z.string(),
  procedureTypeLabel: z.string(),
  implementationPathLabel: z.string(),
  statusLabel: z.string(),
  deadlineLabel: z.string(),
  feeLabel: z.string(),
  contractValueLabel: z.string(),
  qualificationLabel: z.string(),
  sourceTierLabel: z.string(),
  evidenceLevelLabel: z.string(),
  tags: z.array(z.string()),
  description: z.string(),
  eligibilitySummary: z.string(),
  evidenceNote: z.string(),
  officialUrl: z.string().url(),
});

export type ProfessionalOpportunity = z.infer<typeof professionalOpportunitySchema>;

export const sampleOpportunities: ProfessionalOpportunity[] = [
  {
    id: "civic-library-public-square-design-contest",
    slug: "civic-library-public-square-design-contest",
    title: "Civic Library and Public Square Design Contest",
    subtitle:
      "Official public design contest with a negotiated service path after jury review.",
    authorityName: "Comune Demo Nord",
    jurisdictionLabel: "EU / Italy",
    opportunityTypeLabel: "Public design contest",
    procedureTypeLabel: "Design contest",
    implementationPathLabel: "Winner progresses to service award negotiation",
    statusLabel: "Verified",
    deadlineLabel: "Closes 30 Jun 2026",
    feeLabel: "No registration fee",
    contractValueLabel: "Estimated service value EUR 1.85M",
    qualificationLabel: "Licensed architect required",
    sourceTierLabel: "Primary official source",
    evidenceLevelLabel: "Official notice",
    tags: ["Public building", "Urban design", "Licensed architects"],
    description:
      "Municipal design opportunity with a negotiated service path.",
    eligibilitySummary:
      "Lead consultant must hold architect registration or equivalent professional standing. Multidisciplinary teaming allowed.",
    evidenceNote:
      "Sample record. Replace with official notice data before launch.",
    officialUrl: "https://ted.europa.eu/",
  },
  {
    id: "regional-hospital-campus-design-services",
    slug: "regional-hospital-campus-design-services",
    title: "Regional Hospital Campus Expansion Design Services",
    subtitle:
      "Official healthcare design procurement with likely local-partner requirements.",
    authorityName: "Azienda Regionale Infrastrutture Sanitarie",
    jurisdictionLabel: "France / EU",
    opportunityTypeLabel: "Public design services procurement",
    procedureTypeLabel: "Maitrise d'oeuvre procurement",
    implementationPathLabel: "Service contract award after competitive selection",
    statusLabel: "Shortlisted",
    deadlineLabel: "Closes 15 Jul 2026",
    feeLabel: "No participation fee",
    contractValueLabel: "Estimated service value EUR 4.20M",
    qualificationLabel: "Licensed architect plus healthcare references",
    sourceTierLabel: "Primary official source",
    evidenceLevelLabel: "Official listing",
    tags: ["Healthcare", "Procurement", "Local partner likely"],
    description:
      "Service-contract procurement for an established practice.",
    eligibilitySummary:
      "Lead architect qualification required. Healthcare references requested. Local engineering or permitting partner likely needed.",
    evidenceNote:
      "Sample record. Check teaming and insurance requirements in the full dossier.",
    officialUrl: "https://www.boamp.fr/",
  },
];

export const findOpportunityBySlug = (slug: string) => {
  return sampleOpportunities.find((opportunity) => opportunity.slug === slug);
};

export const getRadarSnapshot = (opportunities: ProfessionalOpportunity[]) => {
  const official = opportunities.filter(
    (opportunity) => opportunity.sourceTierLabel === "Primary official source",
  ).length;
  const qualified = opportunities.filter((opportunity) =>
    opportunity.qualificationLabel.toLowerCase().includes("licensed architect"),
  ).length;

  return {
    totalOpen: opportunities.length,
    official,
    qualified,
  };
};
