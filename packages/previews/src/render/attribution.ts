// The imagery credit burned into every generated satellite image. The provider's terms require it
// to stay visible with the imagery, so it is part of the pixels rather than page chrome that a
// card layout could crop or hide. The same text is stored in the manifest.
import { satelliteImageSize } from "./constants";

const BAR_HEIGHT = 24;

const escapeXml = (value: string) =>
  value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

export const buildAttributionOverlay = (text: string) =>
  Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${satelliteImageSize}" height="${satelliteImageSize}" viewBox="0 0 ${satelliteImageSize} ${satelliteImageSize}">
      <rect x="0" y="${satelliteImageSize - BAR_HEIGHT}" width="${satelliteImageSize}" height="${BAR_HEIGHT}" fill="#0e1813" fill-opacity="0.66" />
      <text x="10" y="${satelliteImageSize - 8}" fill="#f3f1e6" font-family="Arial, sans-serif" font-size="11">${escapeXml(text)}</text>
    </svg>`,
  );
