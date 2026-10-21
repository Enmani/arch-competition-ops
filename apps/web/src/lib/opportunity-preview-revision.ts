import { PREVIEW_ALGORITHM_VERSION } from "@arch-competition/previews/version";

/**
 * `?rev=` of every card image URL. It is the preview algorithm version, bumped by hand in
 * packages/previews/src/version.ts. This file is hand-maintained source: no script rewrites it
 * any more, so a build or dev run can no longer leave a tracked file modified.
 *
 * The image route answers `immutable` only for a request whose rev equals this value.
 */
export const opportunityImageRevision = PREVIEW_ALGORITHM_VERSION;
