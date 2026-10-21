/**
 * Version of everything that decides what a generated preview looks like: address extraction,
 * geocoder acceptance rules, tile zoom/overlay, attribution text and the image encoding.
 *
 * Bump it BY HAND whenever a change should regenerate existing previews. It is deliberately not
 * derived from source files: hashing code made the value differ between machines and made every
 * unrelated edit invalidate every cached image (audit P6). The same value is the `?rev=` of the
 * card image URLs, which is what lets the image route answer `immutable` for a matching request.
 *
 * What does NOT need a bump: pipeline plumbing, logging, network hygiene. What DOES: any change
 * to src/address, src/geocode, src/render or src/official-image that alters output.
 */
export const PREVIEW_ALGORITHM_VERSION = "v1";
