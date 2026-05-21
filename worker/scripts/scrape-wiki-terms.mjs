#!/usr/bin/env node
// For mid-cycle entrants (year_elected after the most recent regular cycle),
// pull "Assumed office" + "Preceded by" from their Wikipedia infobox.
// Sets term_start on the new member's legislator_sessions row for the supplied
// session, and term_end on the predecessor's most-recent session if they exist
// as a pdf-only synthetic.
//
// Wikipedia is used because Ballotpedia is behind a CloudFront WAF that
// 202-challenges plain HTTP requests. Coverage is incomplete — not every
// special-election winner has an article. Misses leave term_start NULL.
//
// Usage:
//   node scripts/scrape-wiki-terms.mjs                       # default 24RS
//   node scripts/scrape-wiki-terms.mjs 24RS                  # explicit session
//   node scripts/scrape-wiki-terms.mjs 24RS /tmp/wiki_terms.sql

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SESSION  = process.argv[2] ?? '24RS';
const OUT_PATH = process.argv[3] ?? '/tmp/wiki_terms.sql';

const CACHE_DIR = join(ROOT, '.scrape-cache', 'wiki');
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'la-vote-tracker/0.1 (https://github.com/awebre/RollCallLa) Node-fetch';
const PAUSE_MS = 300;

const MONTHS = {
    january: 1, february: 2, march: 3, april: 4, may: 5, june: 6,
    july: 7, august: 8, september: 9, october: 10, november: 11, december: 12,
};

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

async function fetchCached(url, name) {
    const path = join(CACHE_DIR, name);
    if (existsSync(path)) return readFileSync(path, 'utf8');
    const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept': 'application/json, text/html' } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const text = await res.text();
    writeFileSync(path, text);
    await sleep(PAUSE_MS);
    return text;
}

async function searchWiki(query) {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search=${encodeURIComponent(query)}`;
    const safe = query.replace(/[^A-Za-z0-9_-]/g, '_');
    const json = JSON.parse(await fetchCached(url, `search-${safe}.json`));
    return json[1].map((title, i) => ({ title, url: json[3][i] }));
}

async function fetchArticleHtml(title) {
    const safe = title.replace(/[^A-Za-z0-9_-]/g, '_');
    return fetchCached(
        `https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`,
        `article-${safe}.html`,
    );
}

function looksRight(html, role) {
    const wantChamber = role === 'Sen' ? 'Louisiana (State )?Senate' : 'Louisiana (State )?House';
    return new RegExp(wantChamber, 'i').test(html);
}

function extractAssumedOffice(html) {
    // Wikipedia infobox: <b>Assumed office</b></span>&#32;<br />March 24, 2026</td>
    // The intervening markup varies; search a window after the label for the first 'Month D, YYYY'.
    const idx = html.search(/<b>\s*Assumed office\s*<\/b>/i);
    if (idx < 0) return null;
    const window = html.slice(idx, idx + 600);
    return parseDate(window);
}

function extractPredecessor(html) {
    const idx = html.search(/>\s*Preceded by\s*</i);
    if (idx < 0) return null;
    const window = html.slice(idx, idx + 600);
    const linkMatch = window.match(/<a[^>]*>([^<]+)<\/a>/);
    if (linkMatch) return linkMatch[1].replace(/\s+/g, ' ').trim();
    const tdMatch = window.match(/<td[^>]*>([^<]+)/i);
    return tdMatch ? tdMatch[1].replace(/\s+/g, ' ').trim() : null;
}

function parseDate(s) {
    const m = s.match(/(\w+)\s+(\d{1,2}),\s*(\d{4})/);
    if (!m) return null;
    const month = MONTHS[m[1].toLowerCase()];
    const day = Number(m[2]);
    const year = Number(m[3]);
    if (!month) return null;
    return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

function dayBefore(dateStr) {
    const d = new Date(dateStr + 'T12:00:00Z');
    d.setUTCDate(d.getUTCDate() - 1);
    return d.toISOString().slice(0, 10);
}

// ── load candidates ──────────────────────────────────────────────────────────
console.error(`Loading candidates for ${SESSION} (year_elected >= 2024)...`);
const candidates = runD1(
    `SELECT l.id, l.chamber, l.first_name, l.last_name, ls.role, ls.district, ls.year_elected
     FROM legislators l
     JOIN legislator_sessions ls ON ls.legislator_id = l.id
     WHERE ls.session_name = '${SESSION}' AND ls.active = 1
       AND l.source = 'roster'
       AND ls.year_elected >= 2024
     ORDER BY ls.year_elected, l.last_name`,
);
console.error(`${candidates.length} candidates.`);

// Pre-load pdf-only legislators for predecessor matching.
const synthetics = runD1(
    `SELECT id, chamber, last_name FROM legislators WHERE source = 'pdf'`,
);
const syntheticByKey = new Map();
for (const s of synthetics) syntheticByKey.set(`${s.chamber}|${s.last_name.toLowerCase()}`, s.id);

// ── walk candidates ──────────────────────────────────────────────────────────
const sql = [
    `-- Term dates from Wikipedia for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
];
let hits = 0;
let predecessorHits = 0;

for (const l of candidates) {
    const fullName = `${l.first_name} ${l.last_name}`.trim();
    // Opensearch is full-text on title — appending "Louisiana" drops the actual match
    // because article titles use parenthetical disambig (e.g. "Ed Murray (Louisiana
    // politician)"). Search just the name and verify via article content.
    const results = await searchWiki(fullName);
    let found = null;
    for (const r of results) {
        try {
            const html = await fetchArticleHtml(r.title);
            if (!looksRight(html, l.role)) continue;
            const assumed = extractAssumedOffice(html);
            if (!assumed) continue;
            const predecessor = extractPredecessor(html);
            found = { title: r.title, assumed, predecessor };
            break;
        } catch (e) {
            console.error(`  ${r.title}: ${e.message}`);
        }
    }
    if (!found) {
        console.error(`  ${fullName} (${l.role} D${l.district}) -> no article`);
        continue;
    }
    hits++;
    console.error(`  ${fullName} -> ${found.assumed} (preceded by ${found.predecessor ?? '?'})`);

    sql.push(
        `UPDATE legislator_sessions SET term_start=${escSql(found.assumed)} WHERE legislator_id=${l.id} AND session_name=${escSql(SESSION)};`,
    );

    if (found.predecessor) {
        // Trim parenthetical disambig like "Jason Hughes (politician)" and match by last name.
        const cleanPred = found.predecessor.replace(/\s*\(.+\)\s*$/, '').trim();
        const predLast  = cleanPred.split(/\s+/).at(-1).toLowerCase();
        const synthId   = syntheticByKey.get(`${l.chamber}|${predLast}`);
        if (synthId) {
            predecessorHits++;
            // Update the predecessor's most recent legislator_sessions row's term_end.
            sql.push(
                `UPDATE legislator_sessions SET term_end=${escSql(dayBefore(found.assumed))} ` +
                `WHERE legislator_id=${synthId} AND session_name = ` +
                `(SELECT session_name FROM legislator_sessions WHERE legislator_id=${synthId} ORDER BY session_name DESC LIMIT 1);`,
            );
        }
    }
}

sql.push(`-- end batch`);

writeFileSync(OUT_PATH, sql.join('\n'));
console.error(`Wrote ${OUT_PATH}. ${hits} term_start rows, ${predecessorHits} predecessor term_end rows.`);
