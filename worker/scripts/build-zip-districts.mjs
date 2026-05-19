#!/usr/bin/env node
// Produces worker/geo/2022/zip-districts.json from:
//   - Census TIGER ZCTA polygons (REST API, cached under .build-cache/zcta/)
//   - Existing district GeoJSON files (geo/2022/)
//
// Each key in the output is a 5-digit ZIP code string. Each value:
//   {
//     bbox: [[minLng, minLat], [maxLng, maxLat]],
//     polygon: GeoJSON Polygon or MultiPolygon (simplified at 10%),
//     H: number[],   // house district numbers that intersect this zip
//     S: number[],   // senate district numbers that intersect this zip
//   }
//
// Usage:
//   node scripts/build-zip-districts.mjs
//   npm run build:zip-districts
//
// Runtime: ~2-3 min on first run (API fetch); cached runs are much faster.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import mapshaper from 'mapshaper';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.build-cache', 'zcta');
const DATA_DIR = join(ROOT, 'geo', '2022');

// TIGER REST service for ZCTA5 — layer 1 of PUMA_TAD_TAZ_UGA_ZCTA
// (layer 2 was ZCTA in earlier versions of the service; layer 1 is "2020 Census ZCTA")
const TIGER_REST =
    'https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1/query';

// -------------------------------------------------------------------
// Spatial helpers (no external dep)
// -------------------------------------------------------------------

function flatCoords(geom) {
    const parts =
        geom.type === 'Polygon' ? [geom.coordinates] : geom.coordinates;
    return parts.flat(2);
}

function bboxOf(geom) {
    let minLng = Infinity, minLat = Infinity;
    let maxLng = -Infinity, maxLat = -Infinity;
    for (const [lng, lat] of flatCoords(geom)) {
        if (lng < minLng) minLng = lng;
        if (lng > maxLng) maxLng = lng;
        if (lat < minLat) minLat = lat;
        if (lat > maxLat) maxLat = lat;
    }
    return [[minLng, minLat], [maxLng, maxLat]];
}

function bboxOverlap([[ax1, ay1], [ax2, ay2]], [[bx1, by1], [bx2, by2]]) {
    return ax1 < bx2 && ax2 > bx1 && ay1 < by2 && ay2 > by1;
}

function pointInRing([px, py], ring) {
    let inside = false;
    for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
        const [xi, yi] = ring[i], [xj, yj] = ring[j];
        if ((yi > py) !== (yj > py) && px < (xj - xi) * (py - yi) / (yj - yi) + xi)
            inside = !inside;
    }
    return inside;
}

function edgesIntersect([x1, y1], [x2, y2], [x3, y3], [x4, y4]) {
    const d1x = x2 - x1, d1y = y2 - y1;
    const d2x = x4 - x3, d2y = y4 - y3;
    const cross = d1x * d2y - d1y * d2x;
    if (Math.abs(cross) < 1e-10) return false;
    const t = ((x3 - x1) * d2y - (y3 - y1) * d2x) / cross;
    const u = ((x3 - x1) * d1y - (y3 - y1) * d1x) / cross;
    return t > 0 && t < 1 && u > 0 && u < 1;
}

function ringsIntersect(outerA, outerB) {
    if (pointInRing(outerA[0], outerB)) return true;
    if (pointInRing(outerB[0], outerA)) return true;
    for (let i = 0; i < outerA.length - 1; i++) {
        for (let j = 0; j < outerB.length - 1; j++) {
            if (edgesIntersect(outerA[i], outerA[i + 1], outerB[j], outerB[j + 1]))
                return true;
        }
    }
    return false;
}

function geomIntersects(geomA, geomB, bboxB) {
    const bboxA = bboxOf(geomA);
    if (!bboxOverlap(bboxA, bboxB)) return false;
    const partsA =
        geomA.type === 'Polygon' ? [geomA.coordinates] : geomA.coordinates;
    const partsB =
        geomB.type === 'Polygon' ? [geomB.coordinates] : geomB.coordinates;
    for (const ringsA of partsA) {
        for (const ringsB of partsB) {
            if (ringsIntersect(ringsA[0], ringsB[0])) return true;
        }
    }
    return false;
}

// -------------------------------------------------------------------
// Fetch Louisiana ZCTAs from Census TIGER REST (paginated, cached)
// -------------------------------------------------------------------

async function fetchZCTAs() {
    const cacheFile = join(CACHE_DIR, 'la-zctas.geojson');
    if (existsSync(cacheFile)) {
        console.log(`  cached: ${cacheFile}`);
        return JSON.parse(readFileSync(cacheFile, 'utf8'));
    }

    mkdirSync(CACHE_DIR, { recursive: true });

    const features = [];
    let offset = 0;
    const pageSize = 500;

    while (true) {
        const params = new URLSearchParams({
            where: "ZCTA5 >= '70000' AND ZCTA5 <= '71999'",
            outFields: 'ZCTA5',
            outSR: '4326',
            f: 'geojson',
            geometryPrecision: '5',
            resultOffset: String(offset),
            resultRecordCount: String(pageSize),
        });

        const url = `${TIGER_REST}?${params}`;
        console.log(`  fetching offset=${offset}...`);
        const res = await fetch(url, {
            headers: {
                'User-Agent':
                    'roll-call-la zip-districts build (civic data project)',
            },
        });
        if (!res.ok) throw new Error(`TIGER API ${res.status}: ${url}`);

        const fc = await res.json();
        if (!Array.isArray(fc.features))
            throw new Error(`Unexpected TIGER response: ${JSON.stringify(fc).slice(0, 200)}`);

        features.push(...fc.features);
        console.log(
            `  page: ${fc.features.length} features (total: ${features.length})`,
        );

        if (fc.features.length < pageSize) break;
        offset += pageSize;
    }

    const geojson = { type: 'FeatureCollection', features };
    writeFileSync(cacheFile, JSON.stringify(geojson));
    return geojson;
}

// -------------------------------------------------------------------
// Main
// -------------------------------------------------------------------

console.log('Fetching Louisiana ZCTAs from Census TIGER REST API...');
const rawZctas = await fetchZCTAs();
console.log(`  ${rawZctas.features.length} ZCTAs found`);

console.log('\nSimplifying ZCTA polygons with mapshaper (10% Visvalingam)...');
const simplifiedRaw = await mapshaper.applyCommands(
    '-i zcta.geojson -simplify visvalingam 10% keep-shapes -clean -o format=geojson precision=0.0001 output.geojson',
    { 'zcta.geojson': JSON.stringify(rawZctas) },
);
const simplified = JSON.parse(simplifiedRaw['output.geojson'].toString());
console.log(`  ${simplified.features.length} features after simplification`);

const houseFeats = JSON.parse(
    readFileSync(join(DATA_DIR, 'house.json'), 'utf8'),
).features;
const senateFeats = JSON.parse(
    readFileSync(join(DATA_DIR, 'senate.json'), 'utf8'),
).features;

// Pre-compute per-district bboxes for fast filtering
const houseBboxes = houseFeats.map((f) => bboxOf(f.geometry));
const senateBboxes = senateFeats.map((f) => bboxOf(f.geometry));

console.log(
    `\nIntersecting ${simplified.features.length} ZCTAs × ` +
    `${houseFeats.length} house + ${senateFeats.length} senate districts...`,
);

const zipMap = {};
let i = 0;
for (const feat of simplified.features) {
    const zip = feat.properties?.ZCTA5;
    if (!zip || !feat.geometry) continue;
    if (
        feat.geometry.type !== 'Polygon' &&
        feat.geometry.type !== 'MultiPolygon'
    )
        continue;

    const H = [];
    for (let di = 0; di < houseFeats.length; di++) {
        if (geomIntersects(feat.geometry, houseFeats[di].geometry, houseBboxes[di]))
            H.push(houseFeats[di].properties.district);
    }

    const S = [];
    for (let di = 0; di < senateFeats.length; di++) {
        if (geomIntersects(feat.geometry, senateFeats[di].geometry, senateBboxes[di]))
            S.push(senateFeats[di].properties.district);
    }

    H.sort((a, b) => a - b);
    S.sort((a, b) => a - b);

    zipMap[zip] = {
        bbox: bboxOf(feat.geometry),
        polygon: feat.geometry,
        H,
        S,
    };

    if (++i % 100 === 0)
        console.log(`  ${i}/${simplified.features.length}...`);
}

const outPath = join(DATA_DIR, 'zip-districts.json');

const json = JSON.stringify(zipMap);
writeFileSync(outPath, json);
const sizekb = (Buffer.byteLength(json) / 1024).toFixed(0);
console.log(
    `\nWrote ${outPath} (${sizekb} KB, ${Object.keys(zipMap).length} zip codes)`,
);
console.log('Commit worker/geo/2022/zip-districts.json when ready.');
