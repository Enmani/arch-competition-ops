import assert from "node:assert/strict";
import test from "node:test";
import sharp from "sharp";

import { isInvalidSatellitePreviewBuffer } from "./quality";

test("isInvalidSatellitePreviewBuffer rejects low-entropy pseudo-preview images", async () => {
  const fakePreview = await sharp({
    create: {
      background: "#ddd8cc",
      channels: 3,
      height: 720,
      width: 720,
    },
  })
    .jpeg({ mozjpeg: true, quality: 84 })
    .toBuffer();

  const invalid = await isInvalidSatellitePreviewBuffer(fakePreview);

  assert.equal(invalid, true);
});
