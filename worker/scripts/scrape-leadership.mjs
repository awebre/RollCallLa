#!/usr/bin/env node
// Scrape current chamber leadership and write session_leadership upserts.
//
// Why: vote PDFs refer to the chair as "Mr. Speaker" / "Mr. President" /
// "Madam President Pro Tem" without naming them, and the rosters don't expose
// these roles. parse-rollcalls needs the mapping to attribute chair votes to
// the right legislator.
//
// Sources:
//   - Senate Officers page (single page): title attribute + image filename
//     'Senators2428/Sen<source_id>.jpg' identifies the president + pro tem.
//   - House Speaker page: image 'RepPics24New_OLD/rep<source_id>.jpg' identifies
//     the speaker.
//
// Schema written to: session_leadership (session_id, role, legislator_id).
//
// Usage:
//   node --experimental-strip-types scripts/scrape-leadership.mjs            # default 26RS
//   node --experimental-strip-types scripts/scrape-leadership.mjs 26RS       # explicit session
//   node --experimental-strip-types scripts/scrape-leadership.mjs 26RS /tmp/leadership.sql

import { writeFileSync } from 'node:fs';

const SESSION  = process.argv[2] ?? '26RS';
const OUT_PATH = process.argv[3] ?? '/tmp/leadership.sql';

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA }, redirect: 'follow' });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

/**
 * Walk a leadership page looking for image-by-source_id patterns paired with a
 * title (role) marker. Returns the source_id for each role we care about.
 *
 * Senate: <img title="Senate President" src="Senators2428/Sen9.jpg">
 *         <img title="President Pro Term" src="Senators2428/Sen15.jpg"> (sic — typo "Term")
 */
function extractSenateOfficers(html) {
    const out = { president: null, president_pro_tem: null };
    const matches = html.matchAll(/title="([^"]+)"\s+src="Senators\d+\/Sen(\d+)\.jpg"/gi);
    for (const m of matches) {
        const title = m[1].toLowerCase();
        const sourceId = Number(m[2]);
        if (title.includes('senate president') && !title.includes('pro')) {
            out.president = sourceId;
        } else if (title.includes('pro term') || title.includes('pro tem')) {
            out.president_pro_tem = sourceId;
        }
    }
    return out;
}

/**
 * House Speaker page has the speaker's profile image with a path that embeds
 * source_id: /H_Reps/RepPics24New_OLD/rep41.jpg. The page is dedicated to a
 * single role so we just grab the first matching image.
 */
function extractHouseSpeaker(html) {
    const m = html.match(/\/H_Reps\/RepPics[A-Za-z0-9_]+\/rep(\d+)\.jpg/i);
    return m ? Number(m[1]) : null;
}

// ── fetch + parse ────────────────────────────────────────────────────────────
const senateHtml  = await fetchText('https://senate.la.gov/Officers');
const senate      = extractSenateOfficers(senateHtml);

const houseHtml   = await fetchText('https://house.louisiana.gov/H_Staff/H_Staff_Speaker.aspx');
const speakerId   = extractHouseSpeaker(houseHtml);

console.error('Senate President source_id:        ', senate.president);
console.error('Senate Pro Tem source_id:          ', senate.president_pro_tem);
console.error('House Speaker source_id:           ', speakerId);

if (!senate.president || !senate.president_pro_tem || !speakerId) {
    console.error('ERROR: could not extract all roles from chamber pages');
    process.exit(1);
}

// ── emit SQL ─────────────────────────────────────────────────────────────────
const sessionIdExpr   = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
const legislatorIdExpr = (chamber, sourceId) =>
    `(SELECT id FROM legislators WHERE chamber=${escSql(chamber)} AND source_id=${sourceId})`;

function upsert(role, chamber, sourceId) {
    return `INSERT INTO session_leadership (session_id, role, legislator_id) VALUES (${sessionIdExpr}, ${escSql(role)}, ${legislatorIdExpr(chamber, sourceId)}) ON CONFLICT(session_id, role) DO UPDATE SET legislator_id=excluded.legislator_id;`;
}

const sql = [
    `-- Chamber leadership scraped for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
    upsert('president',         'S', senate.president),
    upsert('president_pro_tem', 'S', senate.president_pro_tem),
    upsert('speaker',           'H', speakerId),
    `-- end batch`,
].join('\n');

writeFileSync(OUT_PATH, sql);
console.error(`Wrote ${OUT_PATH}`);
