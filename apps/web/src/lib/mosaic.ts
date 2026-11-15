/**
 * The card's mosaic transition, as plain functions over a canvas. `p` runs 0..1: 0 is the drawn
 * locator, 1 the satellite image. The first half coarsens the locator into big squares, the
 * second half sharpens the satellite out of them, so the two pictures meet at the coarsest step.
 */
export type MosaicSource = CanvasImageSource & { height?: number; naturalHeight?: number; naturalWidth?: number; width?: number };

/** Coarsest grid, in cells across the card. */
const MIN_CELLS = 7;
/** Beyond this many cells the mosaic is no longer visible, so the source is drawn directly. */
const MAX_CELLS = 96;

const sizeOf = (source: MosaicSource) => ({
  height: source.naturalHeight ?? source.height ?? 1,
  width: source.naturalWidth ?? source.width ?? 1,
});

/** Draws the source to cover the target, like object-fit: cover. */
const drawCover = (ctx: CanvasRenderingContext2D, source: MosaicSource, width: number, height: number) => {
  const { height: sourceHeight, width: sourceWidth } = sizeOf(source);
  const scale = Math.max(width / sourceWidth, height / sourceHeight);
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  ctx.drawImage(source, (width - drawWidth) / 2, (height - drawHeight) / 2, drawWidth, drawHeight);
};

/** Cells across for a progress `t` in 0..1 within one half: 1 is the coarsest, 0 the finest. */
export const cellsFor = (coarseness: number) =>
  Math.round(Math.exp(Math.log(MAX_CELLS) + (Math.log(MIN_CELLS) - Math.log(MAX_CELLS)) * coarseness));

/** Which picture and how coarse, for a progress value: p 0..0.5 coarsens the locator, 0.5..1 sharpens the satellite. */
export const mosaicStage = (p: number) => {
  if (p <= 0.5) {
    return { coarseness: p / 0.5, picture: "locator" as const };
  }
  return { coarseness: (1 - p) / 0.5, picture: "satellite" as const };
};

let scratch: HTMLCanvasElement | null = null;

/** Draws one frame. `locator` is the resting picture, `satellite` null until it has loaded. */
export const drawMosaic = (
  canvas: HTMLCanvasElement,
  p: number,
  locator: MosaicSource,
  satellite: MosaicSource | null,
) => {
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    return;
  }
  const { width, height } = canvas;
  const stage = mosaicStage(p);
  // Until the satellite is here the locator stays at its coarsest step instead of switching.
  const picture = stage.picture === "satellite" && satellite ? satellite : locator;
  const coarseness = stage.picture === "satellite" && !satellite ? 1 : stage.coarseness;

  if (coarseness <= 0.001) {
    ctx.imageSmoothingEnabled = true;
    ctx.clearRect(0, 0, width, height);
    drawCover(ctx, picture, width, height);
    return;
  }

  const cells = cellsFor(coarseness);
  scratch ??= document.createElement("canvas");
  scratch.width = cells;
  scratch.height = cells;
  const small = scratch.getContext("2d");
  if (!small) {
    return;
  }
  small.imageSmoothingEnabled = true;
  small.clearRect(0, 0, cells, cells);
  drawCover(small, picture, cells, cells);

  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, width, height);
  ctx.drawImage(scratch, 0, 0, cells, cells, 0, 0, width, height);
};
