#!/usr/bin/env node
// Parse bill-committee referrals from legis.la.gov BillInfo.aspx action history.
//
// Reads BillInfo.aspx HTML from the scrape-bills.mjs cache if present; fetches
// fresh otherwise.  Emits:
//   1. SQL for bill_committee_referrals  (stdout or --out path)
//   2. JSON moi worklist                 (--moi-list path, default /tmp/moi-list.json)
//      → consumed by scrape-committee-votes.mjs
//
// Usage:
//   node scripts/scrape-bill-referrals.mjs 26RS
//   node scripts/scrape-bill-referrals.mjs 26RS --bill HB1           # smoke test
//   node scripts/scrape-bill-referrals.mjs 26RS --out /tmp/r.sql --moi-list /tmp/m.json

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { parseSession } from '../src/worker/session-id.ts';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let SESSION = '26RS';
const flags = {};
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--bill')     flags.bill     = args[++i];
    else if (a === '--out') flags.out      = args[++i];
    else if (a === '--moi-list') flags.moiList = args[++i];
    else if (!a.startsWith('-')) SESSION = a;
}
const OUT_PATH     = flags.out     ?? '/tmp/referrals.sql';
const MOI_LIST_OUT = flags.moiList ?? '/tmp/moi-list.json';
const SESSION_YEAR = parseSession(SESSION).year;

const UA       = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';
const PAUSE_MS = 120;
const CACHE_DIR = join(ROOT, '.scrape-cache', SESSION, 'billinfo');
mkdirSync(CACHE_DIR, { recursive: true });

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

// ── load committees ───────────────────────────────────────────────────────────
console.error('Loading committees from D1...');
const committeeRows = runD1(
    `SELECT id, chamber, name FROM committees ORDER BY chamber, name`,
);
if (committeeRows.length === 0) {
    console.error('No committees found — run scrape-committees.mjs first.');
    process.exit(1);
}
console.error(`Loaded ${committeeRows.length} committees.`);

function normalizeCommitteeName(name) {
    return name.toLowerCase()
        .replace(/\s*&\s*/g, ' and ')
        .replace(/,\s*and\b/g, ' and')
        .replace(/\s+/g, ' ')
        .trim();
}

// map: `${chamber}:${normalizedName}` → id
const exactMap = new Map();
for (const c of committeeRows) {
    exactMap.set(`${c.chamber}:${normalizeCommitteeName(c.name)}`, c.id);
}

function matchCommittee(rawName, chamber) {
    const norm = normalizeCommitteeName(rawName);
    const exact = exactMap.get(`${chamber}:${norm}`);
    if (exact != null) return exact;
    // prefix match: DB name is a prefix of the action text name
    // e.g. DB="Municipal" matches action="Municipal, Parochial and Cultural Affairs"
    for (const c of committeeRows) {
        if (c.chamber !== chamber) continue;
        const dbNorm = normalizeCommitteeName(c.name);
        if (norm.startsWith(dbNorm) || dbNorm.startsWith(norm)) return c.id;
    }
    return null;
}

// ── load bills ────────────────────────────────────────────────────────────────
console.error(`Loading bills for session ${SESSION}...`);
const billFilter = flags.bill
    ? `AND b.bill_number = '${flags.bill}'`
    : '';
const billRows = runD1(
    `SELECT b.id, b.bill_number, b.originating_chamber
     FROM bills b
     WHERE b.session_name = '${SESSION}' ${billFilter}
     ORDER BY b.bill_number`,
);
if (billRows.length === 0) {
    console.error(`No bills found for session ${SESSION}${flags.bill ? ` (filter: ${flags.bill})` : ''}. Run scrape-bills.mjs first.`);
    process.exit(1);
}
console.error(`Found ${billRows.length} bills to process.`);

// ── helpers ───────────────────────────────────────────────────────────────────
function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

function decode(s) {
    return s
        .replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function mmddToIso(mmdd) {
    const [mm, dd] = mmdd.split('/');
    return `${SESSION_YEAR}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

async function cachedFetch(billNumber) {
    const cachePath = join(CACHE_DIR, `${billNumber}.html`);
    if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
    const url = `https://legis.la.gov/legis/BillInfo.aspx?s=${SESSION}&b=${billNumber}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const text = await res.text();
    writeFileSync(cachePath, text);
    await sleep(PAUSE_MS);
    return text;
}

// ── action-history parser ─────────────────────────────────────────────────────
// Returns { referrals: [...], mois: Set<number> }
//
// Each referral: { referral_date, chamber, committeeName, discharge_date, outcome }
// History in HTML is newest-first; we reverse to process chronologically so the
// open-referral state machine works correctly.
function parseActionHistory(html) {
    const referrals = [];

    // Isolate the action history table from the ListViewHistory panel.
    // The table ends with </table> before the next major panel.
    const histStart = html.indexOf('ListViewHistory');
    if (histStart === -1) return { referrals, mois: new Set() };
    const histEnd   = html.indexOf('</table>', histStart);
    const histHtml  = histEnd > histStart ? html.slice(histStart, histEnd) : html.slice(histStart);

    const rowRe = /<tr\s+valign="top"[^>]*>([\s\S]*?)<\/tr>/gi;
    const rows  = [];
    let m;
    while ((m = rowRe.exec(histHtml)) !== null) {
        const cells = [];
        const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        let cm;
        while ((cm = cellRe.exec(m[1])) !== null) {
            cells.push(decode(cm[1]));
        }
        if (cells.length < 4) continue;
        const dateRaw = cells[0].trim();
        const chamber = cells[1].trim().toUpperCase();
        const action  = cells[3].trim();
        if (!/^\d{2}\/\d{2}$/.test(dateRaw)) continue;
        if (chamber !== 'H' && chamber !== 'S') continue;
        rows.push({ date: mmddToIso(dateRaw), chamber, action });
    }

    rows.reverse(); // process oldest-first

    // open[chamber] = last unanswered referral index in referrals[]
    const openIdx = {};

    for (const { date, chamber, action } of rows) {
        // Skip provisional referrals (superseded by actual referral)
        if (/provisionally\s+referred/i.test(action)) continue;

        // Committee referral
        const refM = action.match(/referred\s+to\s+the\s+Committee\s+on\s+([^.]+)/i);
        if (refM) {
            const committeeName = refM[1].replace(/\.$/, '').trim();
            referrals.push({ referral_date: date, chamber, committeeName, discharge_date: null, outcome: null });
            openIdx[chamber] = referrals.length - 1;
            continue;
        }

        // Discharge — must have a (N-N) vote count, or match "Failed to report" / "Deferred"
        const hasCount  = /\(\d+-\d+\)/.test(action);
        const isFailed  = /failed\s+to\s+report/i.test(action);
        const isDeferred = /(?:involuntarily\s+|voluntarily\s+)?deferred/i.test(action) &&
                           !/referred/i.test(action);

        if (!hasCount && !isFailed && !isDeferred) continue;
        if (openIdx[chamber] == null) continue;

        let outcome = null;
        if (/reported\s+by\s+substitute/i.test(action))        outcome = 'substituted';
        else if (/reported/i.test(action) && hasCount)         outcome = 'reported';
        else if (isFailed)                                     outcome = 'failed';
        else if (isDeferred)                                   outcome = 'deferred';
        if (!outcome) continue;

        referrals[openIdx[chamber]].discharge_date = date;
        referrals[openIdx[chamber]].outcome        = outcome;
        delete openIdx[chamber];
    }

    // Extract CommitteeVote moi links from document menu section
    const mois = new Set();
    const moiRe = /CommitteeVote\.aspx\?moi=(\d+)/gi;
    let mm;
    while ((mm = moiRe.exec(html)) !== null) {
        mois.add(Number(mm[1]));
    }

    return { referrals, mois };
}

// ── main loop ─────────────────────────────────────────────────────────────────
const sessionIdExpr = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
const sqlChunks = [
    `-- scrape-bill-referrals output for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
];

const allMois = new Map(); // moi → { billNumber, chamber (from doc link label) }
const stats   = { bills: 0, referrals: 0, discharged: 0, unmatched: [] };

for (const bill of billRows) {
    let html;
    try {
        html = await cachedFetch(bill.bill_number);
    } catch (e) {
        console.error(`${bill.bill_number}: fetch failed: ${e.message}`);
        continue;
    }

    const { referrals, mois } = parseActionHistory(html);

    for (const ref of referrals) {
        const committeeId = matchCommittee(ref.committeeName, ref.chamber);
        if (committeeId == null) {
            stats.unmatched.push(`${bill.bill_number} ${ref.chamber} "${ref.committeeName}"`);
            continue;
        }

        const billIdExpr = `(SELECT id FROM bills WHERE session_name=${escSql(SESSION)} AND bill_number=${escSql(bill.bill_number)})`;
        sqlChunks.push(
            `INSERT INTO bill_committee_referrals (bill_id, committee_id, referral_date, discharge_date, outcome) VALUES (${billIdExpr}, ${committeeId}, ${escSql(ref.referral_date)}, ${escSql(ref.discharge_date)}, ${escSql(ref.outcome)}) ON CONFLICT(bill_id, committee_id, referral_date) DO UPDATE SET discharge_date=excluded.discharge_date, outcome=excluded.outcome;`,
        );
        stats.referrals++;
        if (ref.outcome) stats.discharged++;
    }

    for (const moi of mois) {
        if (!allMois.has(moi)) {
            allMois.set(moi, { billNumber: bill.bill_number, sessionName: SESSION });
        }
    }

    stats.bills++;
    if (stats.bills % 100 === 0) console.error(`  processed ${stats.bills}/${billRows.length} bills...`);
}

sqlChunks.push('-- end batch');
writeFileSync(OUT_PATH, sqlChunks.join('\n'));

// Write moi worklist for scrape-committee-votes.mjs
const moiList = [...allMois.entries()].map(([moi, meta]) => ({ moi, ...meta }));
writeFileSync(MOI_LIST_OUT, JSON.stringify(moiList, null, 2));

console.error(`Wrote ${OUT_PATH}`);
console.error(`Wrote moi worklist: ${MOI_LIST_OUT} (${moiList.length} moi entries)`);
console.error(`Bills processed: ${stats.bills}`);
console.error(`Referrals emitted: ${stats.referrals} (${stats.discharged} with discharge)`);
if (stats.unmatched.length > 0) {
    console.error(`Unmatched committees (${stats.unmatched.length}):`);
    for (const u of stats.unmatched.slice(0, 20)) console.error(`  ${u}`);
}
