#!/usr/bin/env node
// Scrape bills and roll-call metadata from legis.la.gov for a session.
//
// Strategy:
//  1. Iterate each bill type (HB, HCR, ..., SB, SCR, ...) from 1 upward
//     against the GET-addressable BillInfo.aspx?s=<sid>&b=<type><num>.
//  2. A missing bill returns a generic <title>Louisiana State Legislature</title>;
//     a real one returns <title><BillNum></title>. Stop after N consecutive misses.
//  3. For bills that exist, follow the "Votes" link (BillDocs.aspx?i=<id>&t=votes)
//     and record roll-call PDF links + descriptions. PDFs themselves are NOT
//     parsed here — per-member votes are the next pass.
//  4. All HTTP responses are cached under .scrape-cache/<sid>/ so re-runs are fast.
//
// Usage:
//   node scripts/scrape-bills.mjs            # default session = 24RS
//   node scripts/scrape-bills.mjs 24RS       # explicit session
//   node scripts/scrape-bills.mjs 24RS HB    # one bill type only (faster smoke test)

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { categorize } from '../src/worker/categorize.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SESSION = process.argv[2] ?? '24RS';
const TYPE_FILTER = process.argv[3]; // optional, e.g. "HB" for smoke testing

const BILL_TYPES = [
    { code: 'HB',   chamber: 'H' },
    { code: 'HCR',  chamber: 'H' },
    { code: 'HCSR', chamber: 'H' },
    { code: 'HR',   chamber: 'H' },
    { code: 'HSR',  chamber: 'H' },
    { code: 'SB',   chamber: 'S' },
    { code: 'SCR',  chamber: 'S' },
    { code: 'SR',   chamber: 'S' },
    { code: 'SSR',  chamber: 'S' },
];

const STOP_AFTER_CONSECUTIVE_MISSES = 50;
const PAUSE_MS = 120;
const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

const CACHE_DIR = join(ROOT, '.scrape-cache', SESSION);
mkdirSync(CACHE_DIR, { recursive: true });

async function cachedFetch(url, cacheKey) {
    const cachePath = join(CACHE_DIR, cacheKey);
    if (existsSync(cachePath)) {
        return readFileSync(cachePath, 'utf8');
    }
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const text = await res.text();
    mkdirSync(dirname(cachePath), { recursive: true });
    writeFileSync(cachePath, text);
    await sleep(PAUSE_MS);
    return text;
}

function extractTitle(html) {
    const m = html.match(/<title>([\s\S]*?)<\/title>/i);
    return m ? m[1].trim() : '';
}

function billExists(html, billNumber) {
    // Real bill: title contains the bill number. Missing: generic "Louisiana State Legislature".
    return extractTitle(html).includes(billNumber);
}

function extractBillDocsId(html) {
    const m = html.match(/BillDocs\.aspx\?i=(\d+)/);
    return m ? Number(m[1]) : null;
}

function extractBillTitle(html) {
    // legis.la.gov renders the short title inside a span with id ending in LabelShortTitle.
    // Strip inner HTML tags (the title may contain links / line breaks) and trim.
    const m = html.match(/id="[^"]*LabelShortTitle[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!m) return null;
    const stripped = m[1].replace(/<[^>]+>/g, ' ');
    return decode(stripped).slice(0, 1000) || null;
}

function extractBillStatus(html) {
    const m = html.match(/id="[^"]*LabelCurrentStatus[^"]*"[^>]*>([\s\S]*?)<\/span>/i);
    if (!m) return null;
    const stripped = m[1].replace(/<[^>]+>/g, ' ').replace(/Current Status:/i, '');
    return decode(stripped).slice(0, 500) || null;
}

function decode(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

// Vote-page entries look like:
//   <a href="ViewDocument.aspx?d=1381402"  target="_blank">House Vote on HB 1, CONCUR IN SENATE AMENDMENTS (#1730)</a>
// Capture: doc_id, chamber word, bill number, description, rc number.
const VOTE_ROW_RE =
    /<a\s+href="ViewDocument\.aspx\?d=(\d+)"[^>]*>(House|Senate)\s+Vote\s+on\s+([A-Z]+\s*\d+),\s*([^<(]+?)\s*\(#(\d+)\)\s*<\/a>/g;

function parseVotePage(html, billNumber) {
    const rows = [];
    for (const m of html.matchAll(VOTE_ROW_RE)) {
        const [, docId, chamberWord, refBill, descriptionRaw, rcNum] = m;
        const description = decode(descriptionRaw);
        rows.push({
            doc_id: Number(docId),
            chamber: chamberWord === 'House' ? 'H' : 'S',
            rc_number: Number(rcNum),
            description,
            category: categorize(description),
        });
    }
    return rows;
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

const stats = {
    bills_seen: 0,
    bills_with_votes: 0,
    roll_calls: 0,
    by_category: {},
};

const sqlChunks = [];
sqlChunks.push(`-- Scraped from legis.la.gov for session ${SESSION}`);
sqlChunks.push(`-- ${new Date().toISOString()}`);

// Session row. The session_id is synthetic from sid string: 24RS -> 24001 ; 24ES -> 24002 etc.
// LegiScan-stable IDs come later if we ever swap to that source.
const yearPart = Number(SESSION.slice(0, 2)) + 2000;
const kindCode = { RS: 1, ES: 2, ES1: 3, ES2: 4, ES3: 5 }[SESSION.slice(2)] ?? 9;
const sessionId = Number(SESSION.slice(0, 2)) * 1000 + kindCode;
sqlChunks.push(
    `INSERT INTO sessions (session_id, name, year_start, year_end, special) VALUES (${sessionId}, ${escSql(
        SESSION,
    )}, ${yearPart}, ${yearPart}, ${SESSION.includes('ES') ? 1 : 0}) ON CONFLICT(session_id) DO UPDATE SET name=excluded.name, year_start=excluded.year_start, year_end=excluded.year_end, special=excluded.special;`,
);

// Synthetic bill_id keeps things stable per session: <session>_<type-index>_<num>.
// Pack: session_id * 100000 + typeIdx * 10000 + billNum. Comfortably fits in INTEGER.
function billId(typeIdx, num) {
    return sessionId * 1_000_000 + typeIdx * 10_000 + num;
}

// Synthetic roll_call_id: chamber * 1_000_000_000 + session_id * 100_000 + rc_number.
// rc_number is unique within (chamber, session) on legis.la.gov.
function rollCallId(chamber, rcNum) {
    return (chamber === 'H' ? 1 : 2) * 1_000_000_000 + sessionId * 100_000 + rcNum;
}

const types = TYPE_FILTER
    ? BILL_TYPES.filter((t) => t.code === TYPE_FILTER)
    : BILL_TYPES;
if (types.length === 0) {
    console.error(`No matching bill type for filter ${TYPE_FILTER}`);
    process.exit(1);
}

for (let ti = 0; ti < types.length; ti++) {
    const { code, chamber } = types[ti];
    const typeIdx = BILL_TYPES.findIndex((t) => t.code === code);
    let misses = 0;
    let num = 0;
    while (misses < STOP_AFTER_CONSECUTIVE_MISSES) {
        num++;
        const billNumber = `${code}${num}`;
        const billHtml = await cachedFetch(
            `https://legis.la.gov/legis/BillInfo.aspx?s=${SESSION}&b=${billNumber}`,
            `billinfo/${billNumber}.html`,
        );
        if (!billExists(billHtml, billNumber)) {
            misses++;
            continue;
        }
        misses = 0;
        stats.bills_seen++;

        const bid = billId(typeIdx, num);
        const title = extractBillTitle(billHtml);
        const status = extractBillStatus(billHtml);
        sqlChunks.push(
            `INSERT INTO bills (bill_id, session_id, bill_number, title, description) VALUES (${bid}, ${sessionId}, ${escSql(
                billNumber,
            )}, ${escSql(title)}, ${escSql(status)}) ON CONFLICT(bill_id) DO UPDATE SET session_id=excluded.session_id, bill_number=excluded.bill_number, title=excluded.title, description=excluded.description;`,
        );

        const docsI = extractBillDocsId(billHtml);
        if (!docsI) continue;
        const votesHtml = await cachedFetch(
            `https://legis.la.gov/legis/BillDocs.aspx?i=${docsI}&t=votes`,
            `votes/${billNumber}.html`,
        );
        const rows = parseVotePage(votesHtml, billNumber);
        if (rows.length === 0) continue;
        stats.bills_with_votes++;

        for (const r of rows) {
            stats.roll_calls++;
            stats.by_category[r.category] = (stats.by_category[r.category] || 0) + 1;
            const rcid = rollCallId(r.chamber, r.rc_number);
            // Dates / tallies / passed flag come from PDF parsing in the next pass; default to placeholders.
            sqlChunks.push(
                `INSERT INTO roll_calls (roll_call_id, bill_id, date, chamber, description, vote_category) VALUES (${rcid}, ${bid}, '1970-01-01', ${escSql(
                    r.chamber,
                )}, ${escSql(r.description)}, ${escSql(r.category)}) ON CONFLICT(roll_call_id) DO UPDATE SET bill_id=excluded.bill_id, chamber=excluded.chamber, description=excluded.description, vote_category=excluded.vote_category;`,
            );
        }
    }
    console.error(`${code}: scanned 1..${num - misses}, ${stats.bills_seen} bills total so far`);
}

const outPath = process.argv[4] ?? '/tmp/bills.sql';
writeFileSync(outPath, sqlChunks.join('\n'));
console.error(`Wrote ${outPath}`);
console.error(`Stats: ${JSON.stringify(stats, null, 2)}`);
