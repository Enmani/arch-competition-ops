import sharp from "sharp";

export const minimumViableSatellitePreviewBytes = 12_000;

export const isInvalidSatellitePreviewBuffer = async (previewBuffer: Buffer) => {
  if (previewBuffer.length < minimumViableSatellitePreviewBytes) {
    return true;
  }

  try {
    const stats = await sharp(previewBuffer).stats();
    return stats.entropy < 1.2 || stats.sharpness < 1;
  } catch {
    return true;
  }
};
