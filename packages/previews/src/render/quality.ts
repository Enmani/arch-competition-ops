// Reject generated images that are blank, flat or too small to be a real map crop.
import sharp from "sharp";

export const minimumViableSatellitePreviewBytes = 12_000;

export const isInvalidSatellitePreviewBuffer = async (
  previewBuffer: ArrayBuffer | Uint8Array<ArrayBufferLike>,
) => {
  const previewBytes =
    previewBuffer instanceof Uint8Array ? previewBuffer : new Uint8Array(previewBuffer);
  if (previewBytes.byteLength < minimumViableSatellitePreviewBytes) {
    return true;
  }

  try {
    const stats = await sharp(previewBytes).stats();
    return stats.entropy < 1.2 || stats.sharpness < 1;
  } catch {
    return true;
  }
};
