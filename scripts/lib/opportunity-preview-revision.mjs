import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const satellitePreviewRevisionInputs = [
  "apps/web/src/lib/opportunity-location.ts",
  "apps/web/src/lib/opportunity-satellite-preview.ts",
  "apps/web/src/lib/opportunity-satellite-preview-quality.ts",
];

export const opportunityImageRevisionInputs = [
  "apps/web/src/app/api/opportunities/[slug]/image/route.ts",
  "apps/web/src/lib/opportunity-card-image.ts",
  "apps/web/src/lib/opportunity-card-placeholder.ts",
  ...satellitePreviewRevisionInputs,
];

const buildRevisionFromFiles = async (repoRoot, scope, relativeFilePaths) => {
  const hash = createHash("sha256");
  hash.update(`${scope}\n`);

  for (const relativeFilePath of relativeFilePaths) {
    const absoluteFilePath = path.join(repoRoot, relativeFilePath);
    hash.update(`${relativeFilePath}\n`);
    hash.update(await readFile(absoluteFilePath));
    hash.update("\n");
  }

  return `h${hash.digest("hex").slice(0, 10)}`;
};

export const resolveOpportunityPreviewRevisions = async (repoRoot) => ({
  satellitePreviewRevision: await buildRevisionFromFiles(
    repoRoot,
    "satellite-preview",
    satellitePreviewRevisionInputs,
  ),
  opportunityImageRevision: await buildRevisionFromFiles(
    repoRoot,
    "opportunity-image",
    opportunityImageRevisionInputs,
  ),
});

export const renderOpportunityPreviewRevisionModule = ({
  opportunityImageRevision,
  satellitePreviewRevision,
}) => `export const satellitePreviewRevision = ${JSON.stringify(satellitePreviewRevision)};
export const opportunityImageRevision = ${JSON.stringify(opportunityImageRevision)};
`;

export const writeOpportunityPreviewRevisionModule = async (repoRoot) => {
  const revisions = await resolveOpportunityPreviewRevisions(repoRoot);
  const targetPath = path.join(
    repoRoot,
    "apps",
    "web",
    "src",
    "lib",
    "opportunity-preview-revision.ts",
  );
  await writeFile(
    targetPath,
    renderOpportunityPreviewRevisionModule(revisions),
    "utf8",
  );
  return revisions;
};
