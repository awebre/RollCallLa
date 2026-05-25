#!/usr/bin/env node
// Scrape bill digest PDFs from legis.la.gov and extract abstract text.
//
// Strategy (incremental):
//   1. Load all bills for the session from D1 (id, bill_number, session_name).
//   2. Load existing bill_digests.docs_id values from D1 — skip PDFs already fetched.
//   3. For each bill: fetch BillInfo.aspx (cheap HTML), find all digest links
//      (ViewDocument.aspx?d=<id> with label "Digest of <BillNum> <Version>").
//      Take only the LAST listed link (= latest version).
//   4. If that docs_id is already in D1: skip.
//   5. Otherwise: fetch the PDF, parse with pdfjs-dist, extract abstract + full text.
//   6. Emit SQL UPSERTs to stdout / --out path.
//
// House digests: abstract follows "Abstract:" until "Present law" or end.
// Senate digests: abstract is the prose after the bill header line until
//   "Summary of Amendments", "Present law", or "This bill" on its own line.
//
// Usage:
//   node scripts/scrape-digests.mjs                         # session = 26RS, stdout
//   node scripts/scrape-digests.mjs 26RS                    # explicit session
//   node scripts/scrape-digests.mjs 26RS --bill HB1         # smoke test one bill
//   node scripts/scrape-digests.mjs 26RS --out /tmp/d.sql   # explicit output

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let SESSION = '26RS';
const flags = {};
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--bill')     flags.bill = args[++i];
    else if (a === '--out') flags.out  = args[++i];
    else if (!a.startsWith('-')) SESSION = a;
}
const OUT_PATH = flags.out ?? '/tmp/digests.sql';

const UA       = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';
const PAUSE_MS = 200;
const CACHE_DIR = join(ROOT, '.scrape-cache', SESSION, 'billinfo');
mkdirSync(CACHE_DIR, { recursive: true });

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

// ── load bills ────────────────────────────────────────────────────────────────
console.error(`Loading bills for session ${SESSION}...`);
const billFilter = flags.bill ? `AND b.bill_number = '${flags.bill}'` : '';
const billRows = runD1(
    `SELECT b.id, b.bill_number FROM bills b
     WHERE b.session_name = '${SESSION}' ${billFilter}
     ORDER BY b.bill_number`,
);
if (billRows.length === 0) {
    console.error(`No bills found for ${SESSION}. Run scrape-bills.mjs first.`);
    process.exit(1);
}
console.error(`Found ${billRows.length} bills.`);

// ── load existing docs_ids ────────────────────────────────────────────────────
console.error('Loading existing digest docs_ids from D1...');
const existingRows = runD1(
    `SELECT bd.docs_id FROM bill_digests bd
     JOIN bills b ON b.id = bd.bill_id
     WHERE b.session_name = '${SESSION}'`,
);
const existingDocsIds = new Set(existingRows.map((r) => Number(r.docs_id)));
console.error(`Already have ${existingDocsIds.size} digest(s) in D1.`);

// ── helpers ───────────────────────────────────────────────────────────────────
function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

async function fetchHtml(billNumber) {
    // Always fetch fresh — digest versions change as bills progress through chambers.
    // Only PDFs are skipped (via docs_id dedup in D1).
    const url = `https://legis.la.gov/legis/BillInfo.aspx?s=${SESSION}&b=${billNumber}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    await sleep(PAUSE_MS);
    return res.text();
}

async function fetchPdfBuffer(docsId) {
    const url = `https://legis.la.gov/legis/ViewDocument.aspx?d=${docsId}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`PDF ${url} → ${res.status}`);
    await sleep(PAUSE_MS);
    return Buffer.from(await res.arrayBuffer());
}

async function parsePdfText(buf) {
    // pdfjs-dist legacy build works in Node without a DOM.
    const { getDocument } = await import('pdfjs-dist/legacy/build/pdf.mjs');
    const doc = await getDocument({ data: new Uint8Array(buf) }).promise;
    const pages = [];
    for (let i = 1; i <= doc.numPages; i++) {
        const page = await doc.getPage(i);
        const content = await page.getTextContent();
        pages.push(content.items.map((it) => it.str).join(' '));
    }
    return pages.join('\n');
}

// Extract the digest abstract from full PDF text.
// House bills: explicit "Abstract:" label precedes the one-liner abstract.
// Senate bills: no "Abstract:" label. After "DIGEST", the header line is
//   "<Type> <Num> <Version>   <Year> Regular Session   <Author>", then the
//   abstract text runs until a statute citation like "(Amends R.S. ...)".
function extractAbstract(fullText, billNumber) {
    const text = fullText.replace(/\s+/g, ' ').trim();

    // House: explicit "Abstract:" label
    const absIdx = text.search(/\bAbstract\s*:/i);
    if (absIdx !== -1) {
        const after = text.slice(absIdx + 'Abstract:'.length).trimStart();
        const end = after.search(/\bPresent\s+law\b|\bThis\s+act\b|\bThis\s+bill\b/i);
        return (end === -1 ? after.slice(0, 2000) : after.slice(0, end)).trim() || null;
    }

    // Senate: find "Regular Session" or "Special Session", then skip the
    // author name (single \S+ word after session text) to reach abstract.
    // PDF text: "... 2026 Regular Session   Jenkins Present law relative to..."
    const sessionMatch = text.match(/(?:Regular|Special)\s+Session\s+(\S+)\s+([\s\S]{10,})/i);
    if (sessionMatch) {
        const abstract = sessionMatch[2].trim();
        // Stop at statute citation line
        const end = abstract.search(/\s*\((?:Amends|Adds|Repeals|Creates|Enacts)/i);
        const candidate = (end === -1 ? abstract.slice(0, 2000) : abstract.slice(0, end)).trim();
        return candidate.length > 20 ? candidate : null;
    }

    return null;
}

// Parse digest links from BillInfo.aspx HTML.
// Returns [{ docsId, version }, ...] oldest→newest (as rendered on the page).
function parseDigestLinks(html, billNumber) {
    const results = [];
    // Match hrefs like ViewDocument.aspx?d=12345 with link text like
    // "Digest of HB1 Engrossed" or "Digest of HB1 Original"
    const re = /ViewDocument\.aspx\?d=(\d+)[^>]*>([^<]*)<\/a>/gi;
    let m;
    while ((m = re.exec(html)) !== null) {
        const docsId = Number(m[1]);
        const label  = m[2].trim();
        // Only want digest links (contain "Digest of <billNumber>")
        if (!label.toLowerCase().includes('digest')) continue;
        // Extract version: last word(s) after bill number in label
        const versionMatch = label.match(
            new RegExp(`Digest\\s+of\\s+${billNumber}\\s+(.+)`, 'i'),
        );
        const version = versionMatch ? versionMatch[1].trim() : label;
        results.push({ docsId, version });
    }
    return results;
}

// ── main loop ─────────────────────────────────────────────────────────────────
const sqlChunks = [
    `-- scrape-digests output for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
];
const nowIso = new Date().toISOString();
const stats = { bills: 0, skipped: 0, fetched: 0, errors: 0 };

for (const bill of billRows) {
    let html;
    try {
        html = await fetchHtml(bill.bill_number);
    } catch (e) {
        console.error(`${bill.bill_number}: HTML fetch failed: ${e.message}`);
        stats.errors++;
        continue;
    }

    const digestLinks = parseDigestLinks(html, bill.bill_number);
    if (digestLinks.length === 0) {
        // No digest on this bill yet (common for newly introduced bills)
        stats.skipped++;
        continue;
    }

    // Take only the latest (first-listed) digest version — page renders newest first.
    const { docsId, version } = digestLinks[0];

    if (existingDocsIds.has(docsId)) {
        stats.skipped++;
        continue;
    }

    let abstract = null;
    let fullText = null;
    try {
        const pdfBuf = await fetchPdfBuffer(docsId);
        fullText = await parsePdfText(pdfBuf);
        abstract = extractAbstract(fullText, bill.bill_number);
    } catch (e) {
        console.error(`${bill.bill_number} docs_id=${docsId}: PDF parse failed: ${e.message}`);
        stats.errors++;
        continue;
    }

    const billIdExpr = `(SELECT id FROM bills WHERE session_name=${escSql(SESSION)} AND bill_number=${escSql(bill.bill_number)})`;
    sqlChunks.push(
        `INSERT INTO bill_digests (bill_id, docs_id, version, abstract, full_text, fetched_at) VALUES (${billIdExpr}, ${docsId}, ${escSql(version)}, ${escSql(abstract)}, ${escSql(fullText)}, ${escSql(nowIso)}) ON CONFLICT(docs_id) DO UPDATE SET version=excluded.version, abstract=excluded.abstract, full_text=excluded.full_text, fetched_at=excluded.fetched_at;`,
    );

    stats.fetched++;
    stats.bills++;
    if (stats.bills % 50 === 0) {
        console.error(`  processed ${stats.bills}/${billRows.length} bills (${stats.fetched} new)...`);
    }
}

sqlChunks.push('-- end batch');
writeFileSync(OUT_PATH, sqlChunks.join('\n'));

console.error(`Wrote ${OUT_PATH}`);
console.error(`Bills: ${billRows.length} total | ${stats.fetched} new digests | ${stats.skipped} skipped | ${stats.errors} errors`);
