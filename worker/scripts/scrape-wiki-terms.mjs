#!/usr/bin/env node
// For mid-cycle entrants (year_elected after the most recent regular cycle), pull
// 'Assumed office' + 'Preceded by' from their Wikipedia infobox. Sets term_start on
// the new member and term_end on the predecessor (if we have them as a synthetic row).
//
// Wikipedia is used because Ballotpedia is behind a CloudFront WAF that 202-challenges
// plain HTTP requests. Coverage is incomplete — not every special-election winner has
// an article. Misses leave term_start NULL.
//
// Usage:
//   node scripts/scrape-wiki-terms.mjs           # writes /tmp/wiki_terms.sql
//   wrangler d1 execute DB --local --file /tmp/wiki_terms.sql

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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

function runD1(cmd) {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', cmd, '--json'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const jsonStart = out.indexOf('\n[');
    const json = JSON.parse(out.slice(jsonStart === -1 ? out.indexOf('[') : jsonStart + 1));
    return json[0]?.results ?? [];
}

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

// Wikipedia opensearch: returns [query, [titles], [descriptions], [urls]]
async function searchWiki(query) {
    const url = `https://en.wikipedia.org/w/api.php?action=opensearch&format=json&limit=5&search=${encodeURIComponent(query)}`;
    const safe = query.replace(/[^A-Za-z0-9_-]/g, '_');
    const json = JSON.parse(await fetchCached(url, `search-${safe}.json`));
    return json[1].map((title, i) => ({ title, url: json[3][i] }));
}

async function fetchArticleHtml(title) {
    const safe = title.replace(/[^A-Za-z0-9_-]/g, '_');
    return fetchCached(`https://en.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, '_'))}`, `article-${safe}.html`);
}

function looksRight(html, legislator) {
    // Article must reference Louisiana House/Senate to count as a match.
    const wantChamber = legislator.role === 'Sen' ? 'Louisiana (State )?Senate' : 'Louisiana (State )?House';
    return new RegExp(wantChamber, 'i').test(html);
}

function extractAssumedOffice(html) {
    // Wikipedia infobox: <b>Assumed office</b></span>&#32;<br />March 24, 2026</td>
    // The intervening markup varies, so search a window after the label for the first
    // 'Month D, YYYY' substring.
    const idx = html.search(/<b>\s*Assumed office\s*<\/b>/i);
    if (idx < 0) return null;
    const window = html.slice(idx, idx + 600);
    return parseDate(window);
}

function extractPredecessor(html) {
    // <th>Preceded by</th><td>...<a ...>Jason Hughes</a>...</td>
    const idx = html.search(/>\s*Preceded by\s*</i);
    if (idx < 0) return null;
    const window = html.slice(idx, idx + 600);
    // Pick the first plausible-name span inside an <a> or directly inside a <td>.
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

console.error('Loading candidates (year_elected >= 2024)...');
const candidates = runD1(
    `SELECT people_id, first_name, last_name, role, district, year_elected
     FROM legislators
     WHERE active = 1 AND year_elected >= 2024
     ORDER BY year_elected, last_name`,
);
console.error(`${candidates.length} candidates.`);

console.error('Loading synthetic legislators for predecessor matching...');
const synthetics = runD1(
    `SELECT people_id, last_name, role FROM legislators WHERE people_id BETWEEN 900000 AND 999999`,
);
const syntheticByKey = new Map();
for (const s of synthetics) syntheticByKey.set(`${s.role}|${s.last_name.toLowerCase()}`, s.people_id);

const sql = ['-- Term dates from Wikipedia', `-- ${new Date().toISOString()}`];
let hits = 0, predecessorHits = 0;

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
            if (!looksRight(html, l)) continue;
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
    sql.push(`UPDATE legislators SET term_start=${escSql(found.assumed)} WHERE people_id=${l.people_id};`);
    if (found.predecessor) {
        // Trim parenthetical disambig like "Jason Hughes (politician)" and match by last name.
        const cleanPred = found.predecessor.replace(/\s*\(.+\)\s*$/, '').trim();
        const predLast = cleanPred.split(/\s+/).at(-1).toLowerCase();
        const synth = syntheticByKey.get(`${l.role}|${predLast}`);
        if (synth) {
            predecessorHits++;
            sql.push(`UPDATE legislators SET term_end=${escSql(dayBefore(found.assumed))}, term_source='derived' WHERE people_id=${synth};`);
        }
    }
}

const out = '/tmp/wiki_terms.sql';
writeFileSync(out, sql.join('\n'));
console.error(`Wrote ${out}. ${hits} term_start rows, ${predecessorHits} predecessor term_end rows.`);
