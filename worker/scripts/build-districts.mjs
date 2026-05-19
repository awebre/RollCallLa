#!/usr/bin/env node
// Build simplified GeoJSON for Louisiana's state House and Senate districts
// from US Census TIGER/Line shapefiles.
//
// Source vintage is 2024 — covers the 2024, 2025, and 2026 legislative
// sessions. The 2022 maps (Acts 1 & 5) remain in force; Nairne v. Landry
// is stayed pending Louisiana v. Callais. Revisit after Callais drops.
//
// Output goes into the React app's source tree so Vite can import the files
// as ES modules and code-split them. The Cloudflare Vite plugin's dev
// middleware doesn't pick up new files added under public/ at runtime, so we
// route around it by importing through the module graph instead.
//   worker/src/react-app/data/districts-house.json   (~105 features, ~200-300 KB)
//   worker/src/react-app/data/districts-senate.json  (~39  features, ~100-200 KB)
//
// Properties on each feature are normalized to:
//   { district: <integer> }    // joins with legislators.district on (role, district)
//
// Usage:
//   npm run build:districts            # full rebuild
//   node scripts/build-districts.mjs   # same

import { spawn } from 'node:child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { finished } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const CACHE_DIR = join(ROOT, '.build-cache', 'districts');
const DATA_DIR = join(ROOT, 'src', 'react-app', 'data');

const TIGER_YEAR = 2024;
const STATE_FIPS = '22'; // Louisiana

const SOURCES = [
    {
        label: 'house',
        chamber: 'Rep',
        url: `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}/SLDL/tl_${TIGER_YEAR}_${STATE_FIPS}_sldl.zip`,
        zipName: `tl_${TIGER_YEAR}_${STATE_FIPS}_sldl.zip`,
        districtField: 'SLDLST',
        output: 'districts-house.json',
        expectedCount: 105,
    },
    {
        label: 'senate',
        chamber: 'Sen',
        url: `https://www2.census.gov/geo/tiger/TIGER${TIGER_YEAR}/SLDU/tl_${TIGER_YEAR}_${STATE_FIPS}_sldu.zip`,
        zipName: `tl_${TIGER_YEAR}_${STATE_FIPS}_sldu.zip`,
        districtField: 'SLDUST',
        output: 'districts-senate.json',
        expectedCount: 39,
    },
];

async function download(url, dest) {
    if (existsSync(dest)) {
        const size = statSync(dest).size;
        console.log(`  cached: ${dest} (${(size / 1024).toFixed(0)} KB)`);
        return;
    }
    console.log(`  GET ${url}`);
    const res = await fetch(url, {
        headers: { 'User-Agent': 'roll-call-la districts build (civic data project)' },
    });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    mkdirSync(dirname(dest), { recursive: true });
    await finished(Readable.fromWeb(res.body).pipe(createWriteStream(dest)));
    const size = statSync(dest).size;
    console.log(`  wrote:  ${dest} (${(size / 1024).toFixed(0)} KB)`);
}

function run(cmd, args) {
    return new Promise((resolve, reject) => {
        const p = spawn(cmd, args, { stdio: 'inherit' });
        p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`${cmd} exited ${code}`))));
        p.on('error', reject);
    });
}

mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(DATA_DIR, { recursive: true });

for (const src of SOURCES) {
    console.log(`\n=== ${src.label} (${src.chamber}) ===`);
    const zipPath = join(CACHE_DIR, src.zipName);
    await download(src.url, zipPath);

    const outPath = join(DATA_DIR, src.output);

    // Pipeline:
    //  - read shapefile from zip
    //  - reproject to WGS84 (TIGER ships in NAD83 / EPSG:4269; MapLibre needs WGS84)
    //  - drop every field except the district code
    //  - rename SLDLST/SLDUST -> district
    //  - cast "001"/"105" string codes to integers (matches legislators.district)
    //  - drop TIGER's "ZZZ" unassigned-area feature (water / not in any district)
    //  - clean slivers + topology errors
    //  - full coordinate precision (district boundaries are politically significant)
    await run('npx', [
        '--yes',
        'mapshaper',
        zipPath,
        '-proj', 'wgs84',
        '-filter-fields', src.districtField,
        '-rename-fields', `district=${src.districtField}`,
        '-each', 'district = +district',
        '-filter', 'district > 0',
        '-clean',
        '-o', `format=geojson`, outPath,
    ]);

    // Verify
    const fc = JSON.parse(readFileSync(outPath, 'utf8'));
    const count = fc.features?.length ?? 0;
    const size = statSync(outPath).size;
    console.log(`  -> ${outPath}  ${count} features, ${(size / 1024).toFixed(0)} KB`);
    if (count !== src.expectedCount) {
        console.warn(`  WARNING: expected ${src.expectedCount} features, got ${count}`);
    }

    const districts = fc.features.map((f) => f.properties.district).sort((a, b) => a - b);
    const missing = [];
    for (let i = 1; i <= src.expectedCount; i++) {
        if (!districts.includes(i)) missing.push(i);
    }
    if (missing.length > 0) {
        console.warn(`  WARNING: missing district numbers: ${missing.join(', ')}`);
    } else {
        console.log(`  districts 1..${src.expectedCount} all present`);
    }
}

console.log('\nDone. GeoJSON written to worker/src/react-app/data/. Commit these files.');
