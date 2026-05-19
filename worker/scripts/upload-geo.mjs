#!/usr/bin/env node
// Upload geo asset files to R2. Scans geo/ for vintage directories and skips
// any vintage already present in R2 (probes with house.json HEAD).
//
// Usage:
//   node scripts/upload-geo.mjs                   # remote, all vintages
//   node scripts/upload-geo.mjs --local            # local R2 emulation, all vintages
//   node scripts/upload-geo.mjs --vintage 2022     # specific vintage only
//   npm run upload:geo                             # remote
//   npm run setup:local:geo                        # local

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const GEO_DIR = join(__dirname, '..', 'geo');
const BUCKET = 'roll-call-la-geo';
const GEO_FILES = ['house.json', 'senate.json', 'zip-districts.json'];

const args = process.argv.slice(2);
const local = args.includes('--local');
const vintageIdx = args.indexOf('--vintage');
const specificVintage = vintageIdx !== -1 ? args[vintageIdx + 1] : null;

const vintages = specificVintage
    ? [specificVintage]
    : readdirSync(GEO_DIR).filter(d => statSync(join(GEO_DIR, d)).isDirectory()).sort();

if (vintages.length === 0) {
    console.error('No vintage directories found under geo/');
    process.exit(1);
}

for (const vintage of vintages) {
    const vintageDir = join(GEO_DIR, vintage);
    console.log(`\n=== vintage ${vintage} ===`);

    if (!local) {
        try {
            execFileSync('npx', ['wrangler', 'r2', 'object', 'head',
                `${BUCKET}/${vintage}/house.json`, '--remote'], { stdio: 'pipe' });
            console.log('  already in R2, skipping.');
            continue;
        } catch {
            // Not found — fall through to upload
        }
    }

    for (const file of GEO_FILES) {
        const src = join(vintageDir, file);
        if (!existsSync(src)) {
            console.error(`  Missing: ${src} — run build:districts / build:zip-districts first`);
            process.exit(1);
        }
        const wranglerArgs = [
            'r2', 'object', 'put',
            `${BUCKET}/${vintage}/${file}`,
            '--file', src,
            '--content-type', 'application/json',
            local ? '--local' : '--remote',
        ];
        console.log(`  uploading ${vintage}/${file}...`);
        execFileSync('npx', ['wrangler', ...wranglerArgs], { stdio: 'inherit' });
    }
    console.log('  Done.');
}

// CORS note: bucket CORS must be set once via the Cloudflare API (wrangler's
// `cors set` command uses a different schema than the API and is currently broken).
// CF API body: {"rules":[{"allowed":{"origins":["*"],"methods":["GET","HEAD"],"headers":[]},"maxAgeSeconds":86400}]}
