#!/usr/bin/env node
// Record a digest fixture for snapshot testing.
//
// By default fetches a fresh PDF from legis.la.gov, parses the text, runs
// extractAbstract, and writes the result to
// src/worker/digest-parser-fixtures/<name>.json.
//
// Use --from-d1 to pull full_text from local D1 instead of fetching a PDF
// (faster when the full_text is already cached locally).
//
// Usage:
//   node --experimental-strip-types scripts/record-digest-fixture.mjs \
//     --docs-id 1437553 --bill HB100 --name hb100-original
//
//   node --experimental-strip-types scripts/record-digest-fixture.mjs \
//     --docs-id 1475577 --bill HB2 --name hb2-senate-green-sheet --from-d1

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runD1 } from './lib/d1.mjs';
import { extractAbstract } from '../src/worker/digest-parser.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const FIXTURES_DIR = join(ROOT, 'src/worker/digest-parser-fixtures');

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
    if      (args[i] === '--docs-id') flags.docsId = Number(args[++i]);
    else if (args[i] === '--bill')    flags.bill   = args[++i];
    else if (args[i] === '--name')    flags.name   = args[++i];
    else if (args[i] === '--from-d1') flags.fromD1 = true;
}

if (!flags.docsId || !flags.bill || !flags.name) {
    console.error('Usage: record-digest-fixture.mjs --docs-id <id> --bill <HB100> --name <slug> [--from-d1]');
    process.exit(1);
}

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

async function parsePdfText(buf) {
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        const lineMap = new Map();
        for (const item of content.items) {
            const y = Math.round(item.transform[5]);
            if (!lineMap.has(y)) lineMap.set(y, []);
            lineMap.get(y).push({ x: item.transform[4], str: item.str, width: item.width ?? 0 });
        }
        const sortedYs = [...lineMap.keys()].sort((a, b) => b - a);
        const lines = sortedYs.map((y) => {
            const items = lineMap.get(y).sort((a, b) => a.x - b.x).filter((it) => it.str);
            if (!items.length) return '';
            let line = items[0].str;
            for (let j = 1; j < items.length; j++) {
                const gap = items[j].x - (items[j - 1].x + items[j - 1].width);
                line += gap > 15 ? '  ' : '';
                line += items[j].str;
            }
            return line.trim();
        }).filter(Boolean);
        pages.push(lines.join('\n'));
    }
    return pages.join('\n');
}

let fullText;
let version;

if (flags.fromD1) {
    console.error(`Reading full_text from local D1 for docs_id=${flags.docsId}...`);
    const rows = runD1(
        `SELECT full_text, version FROM bill_digests WHERE docs_id = ${flags.docsId}`,
        { cwd: ROOT },
    );
    if (!rows.length || !rows[0].full_text) {
        console.error(`No full_text in local D1 for docs_id=${flags.docsId}. Run scrape-digests.mjs first.`);
        process.exit(1);
    }
    fullText = rows[0].full_text;
    version  = rows[0].version ?? 'unknown';
} else {
    const url = `https://legis.la.gov/legis/ViewDocument.aspx?d=${flags.docsId}`;
    console.error(`Fetching PDF from ${url}...`);
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) {
        console.error(`HTTP ${res.status} fetching ${url}`);
        process.exit(1);
    }
    await sleep(200);
    const buf = Buffer.from(await res.arrayBuffer());
    console.error(`Parsing PDF (${buf.length} bytes)...`);
    fullText = await parsePdfText(buf);
    version  = 'unknown';
}

const abstract = extractAbstract(fullText);

mkdirSync(FIXTURES_DIR, { recursive: true });

const fixture = {
    docsId:     flags.docsId,
    billNumber: flags.bill,
    version,
    abstract,
    fullText,
};

const outPath = join(FIXTURES_DIR, `${flags.name}.json`);
writeFileSync(outPath, JSON.stringify(fixture, null, 2) + '\n');

console.error(`Wrote ${outPath}`);
console.error(`Abstract: ${abstract ?? '(null)'}`);
