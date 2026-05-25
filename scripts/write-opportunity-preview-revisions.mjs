import path from "node:path";
import { fileURLToPath } from "node:url";
import { writeOpportunityPreviewRevisionModule } from "./lib/opportunity-preview-revision.mjs";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "..");

writeOpportunityPreviewRevisionModule(repoRoot)
  .then(({ opportunityImageRevision, satellitePreviewRevision }) => {
    console.log(
      `Wrote preview revisions: satellite=${satellitePreviewRevision} image=${opportunityImageRevision}`,
    );
  })
  .catch((error) => {
    console.error("Failed to write preview revisions.", error);
    process.exitCode = 1;
  });
