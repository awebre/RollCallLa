#!/usr/bin/env node
// Pull each current legislator's "Year Elected" from their chamber profile page.
// Writes to `legislator_sessions.year_elected` for the supplied session.
//
// Usage:
//   node scripts/scrape-term-dates.mjs                       # default 24RS
//   node scripts/scrape-term-dates.mjs 24RS                  # explicit session
//   node scripts/scrape-term-dates.mjs 24RS /tmp/term_dates.sql
//   npm run scrape:terms

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SESSION  = process.argv[2] ?? '24RS';
const OUT_PATH = process.argv[3] ?? '/tmp/term_dates.sql';

const CACHE_DIR = join(ROOT, '.scrape-cache', 'profiles');
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';
const PAUSE_MS = 120;

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

async function fetchCached(url, name) {
    const cachePath = join(CACHE_DIR, name);
    if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const text = await res.text();
    writeFileSync(cachePath, text);
    await sleep(PAUSE_MS);
    return text;
}

function extractYearElected(html) {
    // House: id="body_FormView1111_YEARELECTEDLabel"
    // Senate: id="body_FormView1111_YEARELECTEDLabel33"
    // Permissive regex on the ID prefix.
    const m = html.match(/id="[^"]*YEARELECTEDLabel\d*"[^>]*>(\d{4})</);
    return m ? Number(m[1]) : null;
}

// Legislators who are members of the supplied session — join through the junction.
const members = runD1(
    `SELECT l.id, l.chamber, l.source_id, ls.role
     FROM legislators l
     JOIN legislator_sessions ls ON ls.legislator_id = l.id
     WHERE ls.session_name = '${SESSION}' AND l.source = 'roster'
     ORDER BY l.chamber, l.source_id`,
);
console.error(`Loading term info for ${members.length} legislators in ${SESSION}...`);

const sql = [
    `-- Term dates scraped from legislator profile pages for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `BEGIN TRANSACTION;`,
];
let resolved = 0;
let unresolved = 0;

for (const m of members) {
    const url = m.chamber === 'S'
        ? `https://senate.la.gov/smembers?ID=${m.source_id}`
        : `https://house.louisiana.gov/H_Reps/members.aspx?ID=${m.source_id}`;
    const cacheName = `${m.chamber}-${m.source_id}.html`;
    let html;
    try {
        html = await fetchCached(url, cacheName);
    } catch (e) {
        console.error(`fetch ${url} failed: ${e.message}`);
        unresolved++;
        continue;
    }
    const year = extractYearElected(html);
    if (year != null) {
        resolved++;
        sql.push(
            `UPDATE legislator_sessions SET year_elected=${year} WHERE legislator_id=${m.id} AND session_name=${escSql(SESSION)};`,
        );
    } else {
        unresolved++;
    }
}

sql.push(`COMMIT;`);

writeFileSync(OUT_PATH, sql.join('\n'));
console.error(`Wrote ${OUT_PATH}`);
console.error(`Resolved year_elected for ${resolved}; missing for ${unresolved}.`);
