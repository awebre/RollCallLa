#!/usr/bin/env node
// Pick N random bills from local D1 and generate digest fixtures for each.
//
// Usage:
//   node --experimental-strip-types scripts/sample-digest-fixtures.mjs [--count 10] [--seed 42]
//
// Skips docs_ids that already have a fixture file in digest-parser-fixtures/.

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runD1 } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'src/worker/digest-parser-fixtures');

const args = process.argv.slice(2);
const flags = { count: 10, seed: Date.now() };
for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--count') flags.count = Number(args[++i]);
    else if (args[i] === '--seed')  flags.seed  = Number(args[++i]);
}

// Seeded PRNG (mulberry32) so results are reproducible when --seed is given.
function makePrng(seed) {
    let s = seed >>> 0;
    return () => {
        s += 0x6d2b79f5;
        let t = Math.imul(s ^ (s >>> 15), 1 | s);
        t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}
const rand = makePrng(flags.seed);

// Load existing fixtures so we skip already-recorded docs_ids.
const existingDocsIds = new Set(
    readdirSync(FIXTURES_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => JSON.parse(readFileSync(join(FIXTURES_DIR, f), 'utf8')).docsId),
);

// Pull all eligible rows from D1.
const rows = runD1(
    `SELECT bd.docs_id, b.bill_number, bd.version
     FROM bill_digests bd
     JOIN bills b ON b.id = bd.bill_id
     WHERE bd.full_text IS NOT NULL`,
    { cwd: ROOT },
);

const eligible = rows.filter((r) => !existingDocsIds.has(r.docs_id));
console.error(`${eligible.length} eligible rows (${existingDocsIds.size} already recorded).`);

// Shuffle and take --count.
for (let i = eligible.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [eligible[i], eligible[j]] = [eligible[j], eligible[i]];
}
const sample = eligible.slice(0, flags.count);

// Derive a slug from bill number + version.
function toSlug(billNumber, version) {
    return `${billNumber}-${version}`
        .toLowerCase()
        .replace(/\s+/g, '-')
        .replace(/[^a-z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
}

console.error(`Generating ${sample.length} fixtures (seed=${flags.seed})...`);

for (const row of sample) {
    const name = toSlug(row.bill_number, row.version);
    // Avoid name collisions with existing files.
    const outPath = join(FIXTURES_DIR, `${name}.json`);
    if (existsSync(outPath)) {
        console.error(`  skip ${name} (file exists)`);
        continue;
    }
    console.error(`  recording ${name} (docs_id=${row.docs_id})...`);
    execFileSync(
        'node',
        [
            '--experimental-strip-types',
            join(__dirname, 'record-digest-fixture.mjs'),
            '--docs-id', String(row.docs_id),
            '--bill',    row.bill_number,
            '--name',    name,
            '--from-d1',
        ],
        { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] },
    );
}

console.error('Done.');
