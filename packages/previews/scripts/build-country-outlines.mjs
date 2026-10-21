// Regenerates packages/previews/data/country-outlines.json from the world-atlas 50m dataset.
//
//   npm run build:outlines -w @arch-competition/previews
//
// The placeholder used to import the whole 756 KB countries-50m.json (and convert every country at
// module load) to draw the outline of the handful of countries we cover. The output of this script
// is committed instead: one small projected SVG path per country plus the Mercator parameters
// needed to place a marker, so the runtime needs neither d3-geo nor topojson-client nor the atlas.
//
// To cover another country: add it to `countries` below, rerun, commit the JSON.
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { geoArea, geoMercator, geoPath } from "d3-geo";
import { feature } from "topojson-client";

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const atlas = JSON.parse(readFileSync(require.resolve("world-atlas/countries-50m.json"), "utf8"));
const atlasVersion = JSON.parse(
  readFileSync(path.join(path.dirname(require.resolve("world-atlas/countries-50m.json")), "package.json"), "utf8"),
).version;

// Which countries get an outline, and how many of their largest polygons to keep (islands,
// overseas territories and the like would otherwise shrink the mainland to a speck), comes from the
// jurisdiction registry: an entry with an `atlasName` gets an outline.
const registry = JSON.parse(readFileSync(path.join(here, "..", "data", "jurisdictions.json"), "utf8"));
const countries = Object.fromEntries(
  Object.entries(registry)
    .filter(([, entry]) => entry.atlasName)
    .map(([key, entry]) => [key, { name: entry.atlasName, polygons: entry.polygonCount ?? 1 }]),
);

const collection = feature(atlas, atlas.objects.countries);
const byName = new Map(collection.features.map((item) => [String(item.properties?.name ?? ""), item]));

const keepLargestPolygons = (item, count) => {
  if (item.geometry?.type !== "MultiPolygon") {
    return item;
  }
  const polygons = item.geometry.coordinates
    .map((coordinates) => ({
      area: geoArea({ coordinates, type: "Polygon" }),
      coordinates,
    }))
    .sort((left, right) => right.area - left.area)
    .slice(0, count);
  return {
    ...item,
    geometry:
      polygons.length === 1
        ? { coordinates: polygons[0].coordinates, type: "Polygon" }
        : { coordinates: polygons.map((polygon) => polygon.coordinates), type: "MultiPolygon" },
  };
};

const round = (value) => Math.round(value * 100) / 100;

// The atlas is far more detailed than a ~400 px locator drawing needs. Rings are simplified in
// projected (pixel) space with Ramer-Douglas-Peucker; sub-pixel islands are dropped.
const SIMPLIFY_EPSILON_PX = 0.6;
const MIN_RING_AREA_PX2 = 6;

const distanceToSegment = ([px, py], [ax, ay], [bx, by]) => {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSquared = dx * dx + dy * dy;
  const t = lengthSquared === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSquared));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
};

const simplifyLine = (points, epsilon) => {
  if (points.length < 3) {
    return points;
  }
  let maxDistance = 0;
  let index = 0;
  for (let i = 1; i < points.length - 1; i += 1) {
    const distance = distanceToSegment(points[i], points[0], points[points.length - 1]);
    if (distance > maxDistance) {
      maxDistance = distance;
      index = i;
    }
  }
  if (maxDistance <= epsilon) {
    return [points[0], points[points.length - 1]];
  }
  return [
    ...simplifyLine(points.slice(0, index + 1), epsilon).slice(0, -1),
    ...simplifyLine(points.slice(index), epsilon),
  ];
};

const ringArea = (ring) =>
  Math.abs(ring.reduce((sum, [x, y], i) => {
    const [nx, ny] = ring[(i + 1) % ring.length];
    return sum + (x * ny - nx * y);
  }, 0)) / 2;

/** Projects a shape and returns a compact, simplified SVG path. */
const buildSimplifiedPath = (projection, shape) => {
  const rings = [];
  let current = null;
  const context = {
    beginPath() {},
    closePath() {
      if (current) {
        rings.push(current);
        current = null;
      }
    },
    lineTo(x, y) {
      current?.push([x, y]);
    },
    moveTo(x, y) {
      current = [[x, y]];
    },
  };
  geoPath(projection, context)(shape);
  const fmt = (value) => String(Math.round(value * 10) / 10);
  return rings
    .filter((ring) => ringArea(ring) >= MIN_RING_AREA_PX2)
    .map((ring) => {
      const simplified = simplifyLine([...ring, ring[0]], SIMPLIFY_EPSILON_PX).slice(0, -1);
      return simplified.length < 3 ? "" : `M${simplified.map(([x, y]) => `${fmt(x)} ${fmt(y)}`).join("L")}Z`;
    })
    .join("");
};
const output = {
  // The viewbox the paths were fitted into; the placeholder draws in a 720x720 frame.
  fitExtent: [
    [140, 110],
    [550, 470],
  ],
  source: `world-atlas@${atlasVersion} countries-50m`,
  countries: {},
};

for (const [key, { name, polygons = 1 }] of Object.entries(countries)) {
  const source = byName.get(name);
  if (!source) {
    throw new Error(`country not found in atlas: ${name}`);
  }
  const shape = keepLargestPolygons(source, polygons);
  const projection = geoMercator().fitExtent(output.fitExtent, shape);
  const pathBuilder = geoPath(projection);
  const centroid = pathBuilder.centroid(shape);
  output.countries[key] = {
    centroid: centroid.every(Number.isFinite) ? centroid.map(round) : null,
    name,
    path: buildSimplifiedPath(projection, shape),
    scale: round(projection.scale()),
    translate: projection.translate().map(round),
  };
}

const target = path.join(here, "..", "data", "country-outlines.json");
writeFileSync(target, `${JSON.stringify(output)}\n`);
console.log(`wrote ${target} (${Object.keys(output.countries).length} countries)`);
