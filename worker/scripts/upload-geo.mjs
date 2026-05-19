#!/usr/bin/env node
// Upload geo asset files to R2 (remote or local Wrangler emulation).
//
// Usage:
//   node scripts/upload-geo.mjs --vintage 2022          # remote
//   node scripts/upload-geo.mjs --vintage 2022 --local  # local dev
//   npm run upload:geo -- --vintage 2022
//   npm run setup:local:geo                             # local, vintage from package.json

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_DIR = join(__dirname, '..', 'src', 'react-app', 'data');

const args = process.argv.slice(2);
const local = args.includes('--local');
const vintageIdx = args.indexOf('--vintage');
if (vintageIdx === -1 || !args[vintageIdx + 1]) {
    console.error('Usage: upload-geo.mjs --vintage <id> [--local]');
    process.exit(1);
}
const vintage = args[vintageIdx + 1];

const FILES = [
    { src: join(DATA_DIR, 'districts-house.json'), key: `${vintage}/house.json` },
    { src: join(DATA_DIR, 'districts-senate.json'), key: `${vintage}/senate.json` },
    { src: join(DATA_DIR, 'zip-districts.json'), key: `${vintage}/zip-districts.json` },
];

const bucket = 'roll-call-la-geo';

for (const { src, key } of FILES) {
    if (!existsSync(src)) {
        console.error(`Missing: ${src} — run build:districts / build:zip-districts first`);
        process.exit(1);
    }
    const wranglerArgs = [
        'r2', 'object', 'put',
        `${bucket}/${key}`,
        '--file', src,
        '--content-type', 'application/json',
        local ? '--local' : '--remote',
    ];
    console.log(`  uploading ${key}${local ? ' (local)' : ''}...`);
    execFileSync('npx', ['wrangler', ...wranglerArgs], { stdio: 'inherit' });
}

console.log(`\nDone. ${FILES.length} files uploaded under vintage "${vintage}".`);

// CORS note: bucket CORS must be set once via the Cloudflare API (wrangler's
// `cors set` command uses a different schema than the API and is currently broken).
// CF API body: {"rules":[{"allowed":{"origins":["*"],"methods":["GET","HEAD"],"headers":[]},"maxAgeSeconds":86400}]}
