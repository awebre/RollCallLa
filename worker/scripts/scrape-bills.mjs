#!/usr/bin/env node
// Scrape bills from legis.la.gov for a session.
//
// Strategy:
//  1. Iterate each bill type (HB, HCR, ..., SB, SCR, ...) from 1 upward
//     against BillInfo.aspx?s=<sid>&b=<type><num>. A missing bill returns a
//     generic <title>Louisiana State Legislature</title>; a real one returns
//     <title><BillNum></title>. Stop after N consecutive misses per type.
//  2. For bills that exist, extract: title, raw status text, docs_id (legis.la.gov
//     internal id used by BillDocs.aspx for PDF discovery), plus a normalised
//     pipeline_stage + next_chamber derived from the status text.
//  3. PDF discovery and roll-call ingest is a SEPARATE pass (parse-rollcalls.mjs),
//     which uses `bills.docs_id` to find new PDFs and parse them.
//
// No more shell roll_call rows — this script only writes bills.
//
// Output: SQL on stdout (or file via arg 4) with one session upsert + bills
// upserts using the new natural-key UNIQUE constraints
// (sessions.name, bills.session_name+bill_number).
//
// Usage:
//   node scripts/scrape-bills.mjs                       # default session = 24RS, stdout
//   node scripts/scrape-bills.mjs 24RS                  # explicit session
//   node scripts/scrape-bills.mjs 24RS HB               # one bill type only (smoke test)
//   node scripts/scrape-bills.mjs 24RS '' /tmp/bills.sql  # explicit output path

import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { parseSession, isSpecialSession } from '../src/worker/session-id.ts';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SESSION = process.argv[2] ?? '24RS';
const TYPE_FILTER = process.argv[3] || null; // optional, e.g. "HB" for smoke testing
const OUT_PATH = process.argv[4] ?? '/tmp/bills.sql';

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

// Cache only the missing-bill probe results (cheap to recompute) and existing-bill
// HTML for the current run. The refresh workflow drops the cache for billinfo/ so
// LabelCurrentStatus is fresh every night — see .github/workflows/refresh-data.yml.
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

/**
 * Best-effort classifier for LabelCurrentStatus into our pipeline_stage vocabulary.
 *
 * Tuned against real 24RS + 26RS status text. Notable sample patterns:
 *   "Signed by the Governor - Act 4"           → enacted (bills)
 *   "Sent to the Secretary of State"            → enacted (resolutions)
 *   "Signed by the President / Speaker"         → governor (enrollment, heading to Gov)
 *   "Pending House Appropriations"              → committee
 *   "Passed the House" / "Passed the Senate"    → floor (between final passage and engross)
 *   "Pending Legislative Bureau"                → floor (engrossment workflow)
 *   "Subject to call - Senate final passage"    → floor
 *   "Subject to call - Senate referral"         → committee
 *   "Rejected in the House"                     → dead
 *
 * Order matters — most-specific patterns first.
 */
function categoriseStatus(statusText, originatingChamber) {
    if (!statusText) return { stage: 'introduced', next_chamber: null };
    const t = statusText.toLowerCase();

    // Enacted: bills signed by governor, resolutions filed with Secretary of State,
    // or any text mentioning an Act number / effective date / "became law".
    if (/signed\s+by\s+(the\s+)?governor|sent\s+to\s+the\s+secretary\s+of\s+state|\bact\s+(?:no\.?\s*)?\d|\beffective\b|\bbecame\s+law\b/.test(t)) {
        return { stage: 'enacted', next_chamber: null };
    }
    // On governor's desk (sent but not yet signed). "Signed by the President" /
    // "Signed by the Speaker" are the enrollment steps that precede sending to
    // the Governor; treat them as governor too — the bill's next stop is Gov.
    if (
        /sent\s+to\s+(the\s+)?governor|on\s+governor'?s?\s+desk|delivered\s+to\s+(the\s+)?governor/.test(t) ||
        /signed\s+by\s+(the\s+)?(?:president|speaker)/.test(t)
    ) {
        return { stage: 'governor', next_chamber: null };
    }
    // Dead-end states
    if (
        /withdrawn|indefinitely\s+(?:postponed|deferred)|failed\s+to\s+pass|died\s+in\s+committee|vetoed/.test(t) ||
        /failed\s+(?:house|senate)\s+final\s+passage/.test(t) ||
        /rejected\s+in\s+the\s+(?:house|senate)/.test(t) ||
        /substitute\s+adopted\s+on\s+the\s+(?:house|senate)\s+floor/.test(t) ||  // original replaced by substitute
        /involuntarily\s+deferred/.test(t)
    ) {
        return { stage: 'dead', next_chamber: null };
    }
    // Concurrence — originating chamber must accept other chamber's amendments
    if (/concurrence|returned\s+from\s+(house|senate)|conference\s+committee|amendments\s+rejected/.test(t)) {
        return { stage: 'concurrence', next_chamber: originatingChamber };
    }
    // Floor activity (final passage, readings, calendar, "subject to call",
    // passed-chamber, and the Legislative Bureau engrossment workflow).
    // Match floor keywords first so "Pending House final passage" doesn't fall through to committee.
    if (
        /(?:pending|on|subject\s+to\s+call(?:\s*[-:]?\s*)?)\s*(?:house|senate)?\s+(?:floor|final\s+passage|third\s+reading|second\s+reading|calendar)/.test(t) ||
        /passed\s+(?:by\s+(?:the\s+)?)?(?:the\s+)?(house|senate)/.test(t) ||
        /\bread\s+by\s+title\b/.test(t) ||
        /\blegislative\s+bureau\b/.test(t)
    ) {
        const m = t.match(/(house|senate)/);
        return { stage: 'floor', next_chamber: m ? (m[1] === 'house' ? 'H' : 'S') : null };
    }
    // Committee — "Pending <chamber> <committee-name>", explicit committee verbs,
    // or "Subject to call - <chamber> referral" (queued for committee assignment).
    // The chamber name is followed by a committee name (any non-whitespace), not a
    // floor keyword (those were caught above).
    if (
        /pending\s+(house|senate)\s+\S/.test(t) ||
        /(?:referred\s+to|reported\s+by|heard\s+by)\s+(?:the\s+)?(?:house|senate)?\s*committee/.test(t) ||
        /subject\s+to\s+call.*\b(house|senate)\s+referral/.test(t)
    ) {
        const m = t.match(/(?:pending|referral)?\s*(house|senate)/);
        return { stage: 'committee', next_chamber: m ? (m[1] === 'house' ? 'H' : 'S') : null };
    }
    // Introduced — includes "Distributed to <chamber> members" which is the
    // pre-introduction state before a bill is officially read.
    if (/introduced|pending\s+introduction|filed|prefiled|read\s+first\s+time|distributed\s+to\s+(?:house|senate)\s+members/.test(t)) {
        return { stage: 'introduced', next_chamber: originatingChamber };
    }
    return { stage: 'other', next_chamber: null };
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

const stats = {
    bills_seen: 0,
    by_type: {},
    by_stage: {},
};

const sqlChunks = [];
sqlChunks.push(`-- Scraped from legis.la.gov for session ${SESSION}`);
sqlChunks.push(`-- ${new Date().toISOString()}`);
sqlChunks.push(`-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`);

// ── session upsert ────────────────────────────────────────────────────────────
const sessionParsed = parseSession(SESSION);
const sessionType = isSpecialSession(SESSION) ? 'special' : 'regular';
sqlChunks.push(
    `INSERT INTO sessions (name, year, type) VALUES (${escSql(SESSION)}, ${sessionParsed.year}, ${escSql(sessionType)}) ON CONFLICT(name) DO UPDATE SET year=excluded.year, type=excluded.type;`,
);

// Subquery used in every bill row to resolve sessions.id from the session name.
// Cheap — sessions table is tiny and the value is constant per run.
const sessionIdExpr = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;

const types = TYPE_FILTER
    ? BILL_TYPES.filter((t) => t.code === TYPE_FILTER)
    : BILL_TYPES;
if (types.length === 0) {
    console.error(`No matching bill type for filter ${TYPE_FILTER}`);
    process.exit(1);
}

const nowIso = new Date().toISOString();

for (const { code, chamber } of types) {
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
        stats.by_type[code] = (stats.by_type[code] || 0) + 1;

        const title = extractBillTitle(billHtml);
        const statusText = extractBillStatus(billHtml);
        const docsId = extractBillDocsId(billHtml);
        const { stage, next_chamber } = categoriseStatus(statusText, chamber);
        stats.by_stage[stage] = (stats.by_stage[stage] || 0) + 1;

        sqlChunks.push(
            `INSERT INTO bills (session_id, session_name, bill_number, bill_type, originating_chamber, title, docs_id, pipeline_stage, next_chamber, status_text, last_scraped_at) VALUES (${sessionIdExpr}, ${escSql(
                SESSION,
            )}, ${escSql(billNumber)}, ${escSql(code)}, ${escSql(chamber)}, ${escSql(title)}, ${
                docsId ?? 'NULL'
            }, ${escSql(stage)}, ${escSql(next_chamber)}, ${escSql(statusText)}, ${escSql(nowIso)}) ON CONFLICT(session_name, bill_number) DO UPDATE SET title=excluded.title, docs_id=excluded.docs_id, pipeline_stage=excluded.pipeline_stage, next_chamber=excluded.next_chamber, status_text=excluded.status_text, last_scraped_at=excluded.last_scraped_at;`,
        );
    }
    console.error(`${code}: scanned 1..${num - misses}, ${stats.bills_seen} bills total so far`);
}

sqlChunks.push(`-- end batch`);

writeFileSync(OUT_PATH, sqlChunks.join('\n'));
console.error(`Wrote ${OUT_PATH}`);
console.error(`Stats: ${JSON.stringify(stats, null, 2)}`);
