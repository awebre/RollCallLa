#!/usr/bin/env node
// Pull each current legislator's "Year Elected" from their profile page.
// One GET per member (~144 requests). Cached for re-runs.
//
// Usage:
//   node scripts/scrape-term-dates.mjs
//   wrangler d1 execute la_vote_tracker --local --file /tmp/term_dates.sql
// Or:
//   npm run scrape:terms

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
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
    // Use a permissive regex on the ID prefix.
    const m = html.match(/id="[^"]*YEARELECTEDLabel\d*"[^>]*>(\d{4})</);
    return m ? Number(m[1]) : null;
}

const legislators = runD1(
    `SELECT people_id, role FROM legislators WHERE active = 1 ORDER BY people_id`,
);
console.error(`Loading term info for ${legislators.length} legislators...`);

const sql = ['-- Term dates scraped from legislator profile pages', `-- ${new Date().toISOString()}`];
let resolved = 0;
let unresolved = 0;
for (const l of legislators) {
    const siteId = l.people_id % 10000;
    let url, name;
    if (l.role === 'Sen') {
        url = `https://senate.la.gov/smembers?ID=${siteId}`;
        name = `S-${siteId}.html`;
    } else {
        url = `https://house.louisiana.gov/H_Reps/members.aspx?ID=${siteId}`;
        name = `H-${siteId}.html`;
    }
    let html;
    try {
        html = await fetchCached(url, name);
    } catch (e) {
        console.error(`fetch ${url} failed: ${e.message}`);
        unresolved++;
        continue;
    }
    const year = extractYearElected(html);
    if (year) {
        resolved++;
        sql.push(`UPDATE legislators SET year_elected=${year} WHERE people_id=${l.people_id};`);
    } else {
        unresolved++;
    }
}

const outPath = '/tmp/term_dates.sql';
writeFileSync(outPath, sql.join('\n'));
console.error(`Wrote ${outPath}`);
console.error(`Resolved year_elected for ${resolved}; missing for ${unresolved}.`);
