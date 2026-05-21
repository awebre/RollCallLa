#!/usr/bin/env node
// Scrape current senate.la.gov and house.louisiana.gov rosters into SQL upserts.
//
// Writes both `legislators` (one row per person, identified by chamber+source_id
// from the chamber site) and `legislator_sessions` (per-session role/party/
// district/active for the supplied session). The session row itself is upserted
// too so the script can run first in the pipeline.
//
// Usage:
//   node scripts/scrape-rosters.mjs                       # default session = 24RS
//   node scripts/scrape-rosters.mjs 24RS                  # explicit session
//   node scripts/scrape-rosters.mjs 24RS /tmp/rosters.sql # explicit output path
//   npm run scrape:rosters

import { writeFileSync } from 'node:fs';

import { parseSession, isSpecialSession } from '../src/worker/session-id.ts';

const SESSION  = process.argv[2] ?? '24RS';
const OUT_PATH = process.argv[3] ?? '/tmp/rosters.sql';

const SENATE_URL = 'https://senate.la.gov/Senators_FullInfo.aspx';
const HOUSE_URL  = 'https://house.louisiana.gov/H_Reps/H_Reps_FullInfo';

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
}

function decode(s) {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .trim();
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

// Name parsing — see comments below for examples.
const TRAILING_SUFFIXES = new Set(['Jr.', 'Jr', 'Sr.', 'Sr', 'II', 'III', 'IV', 'V']);

function splitLastNameSuffix(last) {
    const tokens = last.split(/\s+/);
    if (tokens.length >= 2 && TRAILING_SUFFIXES.has(tokens[tokens.length - 1])) {
        const suffixTok = tokens.pop();
        return { last: tokens.join(' '), suffix: suffixTok };
    }
    return { last, suffix: null };
}

/**
 * Parse roster-formatted names:
 *   "Carter, Sr., Wilford"            -> last: "Carter", suffix: "Sr.", first: "Wilford"
 *   "Adams, Roy Daryl"                 -> last: "Adams", first: "Roy Daryl"
 *   "Beaullieu, IV, Gerald \"Beau\""   -> last: "Beaullieu", suffix: "IV", first: "Gerald", nickname: "Beau"
 *   "Barthelemy II, Sidney"            -> last: "Barthelemy", suffix: "II", first: "Sidney"
 *     (some rows omit the comma before the suffix; pull it off the trailing token
 *     of the last-name segment so PDFs that print just "Barthelemy" still match.)
 */
function splitName(lastFirst) {
    const parts = lastFirst.split(',').map((p) => p.trim()).filter(Boolean);
    let last = '', suffix = null, first = '';
    if (parts.length === 2) {
        [last, first] = parts;
    } else if (parts.length >= 3) {
        last = parts[0];
        suffix = parts[1];
        first = parts.slice(2).join(', ');
    } else {
        last = parts[0] ?? '';
    }
    if (!suffix) {
        const stripped = splitLastNameSuffix(last);
        last = stripped.last;
        suffix = stripped.suffix;
    }
    let nickname = null;
    const nickMatch = first.match(/"([^"]+)"/);
    if (nickMatch) {
        nickname = nickMatch[1];
        first = first.replace(/\s*"[^"]+"\s*/, ' ').replace(/\s+/g, ' ').trim();
    }
    return { last, suffix, first, nickname };
}

function partyCode(party) {
    if (!party) return null;
    const p = party.toLowerCase();
    if (p.startsWith('rep')) return 'R';
    if (p.startsWith('dem')) return 'D';
    if (p.startsWith('ind')) return 'I';
    return party.slice(0, 1).toUpperCase();
}

// ASP.NET ListView span IDs: <chamber-prefix>_LASTFIRSTLabel_<N>, etc.
// Records align by trailing index, so we extract each label set and zip by N.
function extractRoster(html, opts) {
    const { idAttr, namePattern, districtPattern, partyPattern, chamber, role } = opts;
    const idRe        = new RegExp(idAttr, 'g');
    const nameRe      = new RegExp(namePattern, 'g');
    const districtRe  = new RegExp(districtPattern, 'g');
    const partyRe     = new RegExp(partyPattern, 'g');

    // Each member's link appears twice per fieldset (image + name link). Collapse runs of duplicates.
    const collapseAdjacentDupes = (arr) => arr.filter((v, i) => i === 0 || v !== arr[i - 1]);
    const ids       = collapseAdjacentDupes([...html.matchAll(idRe)].map((m) => Number(m[1])));
    const names     = [...html.matchAll(nameRe)].map((m) => decode(m[1]));
    const districts = [...html.matchAll(districtRe)].map((m) => Number(m[1]));
    const parties   = [...html.matchAll(partyRe)].map((m) => decode(m[1]));

    const n = Math.min(ids.length, names.length, districts.length, parties.length);
    const out = [];
    for (let i = 0; i < n; i++) {
        const { last, first, suffix, nickname } = splitName(names[i]);
        out.push({
            chamber,
            source_id:  ids[i],
            first_name: first,
            last_name:  last,
            suffix,
            nickname,
            party:      partyCode(parties[i]),
            role,
            district:   districts[i],
        });
    }
    return out;
}

function buildLegislatorUpserts(rows) {
    const lines = [];
    for (const r of rows) {
        lines.push(
            'INSERT INTO legislators (chamber, source_id, last_name, first_name, suffix, nickname, party, district, source) VALUES (' +
            [
                escSql(r.chamber),
                r.source_id,
                escSql(r.last_name),
                escSql(r.first_name),
                escSql(r.suffix),
                escSql(r.nickname),
                escSql(r.party),
                r.district,
                escSql('roster'),
            ].join(', ') +
            ') ON CONFLICT(chamber, source_id) DO UPDATE SET ' +
            'last_name=excluded.last_name, first_name=excluded.first_name, ' +
            'suffix=excluded.suffix, nickname=excluded.nickname, party=excluded.party, ' +
            'district=excluded.district, source=excluded.source;'
        );
    }
    return lines.join('\n');
}

function buildLegislatorSessionUpserts(rows) {
    const lines = [];
    for (const r of rows) {
        const legislatorIdExpr = `(SELECT id FROM legislators WHERE chamber=${escSql(r.chamber)} AND source_id=${r.source_id})`;
        const sessionIdExpr    = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
        lines.push(
            'INSERT INTO legislator_sessions (legislator_id, session_id, session_name, role, party, district, active) VALUES (' +
            [
                legislatorIdExpr,
                sessionIdExpr,
                escSql(SESSION),
                escSql(r.role),
                escSql(r.party),
                r.district,
                1,
            ].join(', ') +
            ') ON CONFLICT(legislator_id, session_name) DO UPDATE SET ' +
            'role=excluded.role, party=excluded.party, district=excluded.district, active=excluded.active;'
        );
    }
    return lines.join('\n');
}

// ── fetch + parse ────────────────────────────────────────────────────────────
const senateHtml = await fetchText(SENATE_URL);
const senators = extractRoster(senateHtml, {
    idAttr:          /smembers\.aspx\?ID=(\d+)/.source,
    namePattern:     /id="body_ListView11_LASTFIRSTLabel_\d+">([^<]+)</.source,
    districtPattern: /id="body_ListView11_DISTRICTNUMBERLabel1_\d+">(\d+)</.source,
    partyPattern:    /id="body_ListView11_PARTYAFFILIATIONLabel1_\d+">([^<]+)</.source,
    chamber: 'S',
    role:    'Sen',
});

const houseHtml = await fetchText(HOUSE_URL);
const reps = extractRoster(houseHtml, {
    idAttr:          /\/H_Reps\/members\.aspx\?ID=(\d+)/.source,
    namePattern:     /id="body_ListView1w2_LASTFIRSTLabel_\d+">([^<]+)</.source,
    districtPattern: /id="body_ListView1w2_DISTRICTNUMBERLabelw_\d+">(\d+)</.source,
    partyPattern:    /id="body_ListView1w2_PARTYAFFILIATIONLabelw_\d+">([^<]+)</.source,
    chamber: 'H',
    role:    'Rep',
});

console.error(`Senate: ${senators.length} members. House: ${reps.length} members.`);

// ── emit SQL ─────────────────────────────────────────────────────────────────
const sessionParsed = parseSession(SESSION);
const sessionType = isSpecialSession(SESSION) ? 'special' : 'regular';

const sql = [
    `-- Scraped from senate.la.gov + house.louisiana.gov for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
    `INSERT INTO sessions (name, year, type) VALUES (${escSql(SESSION)}, ${sessionParsed.year}, ${escSql(sessionType)}) ON CONFLICT(name) DO UPDATE SET year=excluded.year, type=excluded.type;`,
    buildLegislatorUpserts(senators),
    buildLegislatorUpserts(reps),
    buildLegislatorSessionUpserts(senators),
    buildLegislatorSessionUpserts(reps),
    `-- end batch`,
].join('\n');

writeFileSync(OUT_PATH, sql);
console.error(`Wrote ${OUT_PATH}`);
