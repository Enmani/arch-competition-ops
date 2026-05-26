export const minimumViableSatellitePreviewBytes = 12_000;

type SatellitePreviewBufferInput = ArrayBuffer | Uint8Array<ArrayBufferLike>;

type SharpImport = typeof import("sharp");
type SharpFactory = SharpImport extends { default: infer T } ? T : SharpImport;

let sharpModulePromise: Promise<SharpFactory | null> | null = null;

const loadSharp = () => {
  sharpModulePromise ??= import("sharp")
    .then((module) => ("default" in module ? module.default : module))
    .catch(() => null);

  return sharpModulePromise;
};

const toPreviewBytes = (previewBuffer: SatellitePreviewBufferInput) =>
  previewBuffer instanceof Uint8Array ? previewBuffer : new Uint8Array(previewBuffer);

export const isInvalidSatellitePreviewBuffer = async (
  previewBuffer: SatellitePreviewBufferInput,
) => {
  const previewBytes = toPreviewBytes(previewBuffer);
  if (previewBytes.byteLength < minimumViableSatellitePreviewBytes) {
    return true;
  }

  const sharp = await loadSharp();
  if (!sharp) {
    return false;
  }

  try {
    const stats = await sharp(previewBytes).stats();
    return stats.entropy < 1.2 || stats.sharpness < 1;
  } catch {
    return true;
  }
};
