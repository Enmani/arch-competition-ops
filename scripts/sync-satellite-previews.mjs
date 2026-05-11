import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentDirectory = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(currentDirectory, "..");
const sourceDirectory = path.join(repoRoot, "artifacts", "opportunity-card-satellite", "images");
const targetDirectory = path.join(repoRoot, "apps", "web", "public", "opportunity-card-satellite");

const syncSatellitePreviews = async () => {
  await rm(targetDirectory, { force: true, recursive: true });
  await mkdir(targetDirectory, { recursive: true });

  let sourceEntries = [];
  try {
    sourceEntries = await readdir(sourceDirectory, { withFileTypes: true });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      console.log("No local satellite preview cache found. Continuing with an empty static preview set.");
      return;
    }

    throw error;
  }

  const copyJobs = sourceEntries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      cp(path.join(sourceDirectory, entry.name), path.join(targetDirectory, entry.name)),
    );

  await Promise.all(copyJobs);
  console.log(
    `Synced ${copyJobs.length} satellite preview image(s) to ${path.relative(repoRoot, targetDirectory)}`,
  );
};

syncSatellitePreviews().catch((error) => {
  console.error("Failed to sync satellite previews.", error);
  process.exitCode = 1;
});
