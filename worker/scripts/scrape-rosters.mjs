#!/usr/bin/env node
// Scrape current senate.la.gov and house.louisiana.gov rosters into SQL upserts.
//
// people_id encoding (since the LA gov sites use chamber-local IDs):
//   Senate: 10000 + site_id   (e.g. Abraham (S25) -> 10025)
//   House:  20000 + site_id   (e.g. Adams (H62)   -> 20062)
//
// Usage:
//   node scripts/scrape-rosters.mjs > /tmp/rosters.sql
//   wrangler d1 execute DB --local --file /tmp/rosters.sql
// Or just:
//   npm run scrape:rosters

import { writeFileSync } from 'node:fs';

const SENATE_URL = 'https://senate.la.gov/Senators_FullInfo.aspx';
const HOUSE_URL  = 'https://house.louisiana.gov/H_Reps/H_Reps_FullInfo';

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
}

// HTML decode helper for entities we'll actually encounter on these pages.
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

// "Carter, Sr., Wilford"        -> { last: 'Carter', suffix: 'Sr.', first: 'Wilford' }
// "Adams, Roy Daryl"             -> { last: 'Adams', first: 'Roy Daryl' }
// "Beaullieu, IV, Gerald \"Beau\"" -> { last: 'Beaullieu', suffix: 'IV', first: 'Gerald', nickname: 'Beau' }
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
// Records are aligned by trailing index, so we extract each label set and zip by N.
function extractRoster(html, opts) {
    const { idAttr, namePattern, districtPattern, partyPattern, chamberCode, role } = opts;
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
            people_id: chamberCode * 10000 + ids[i],
            site_id: ids[i],
            first_name: first,
            middle_name: null,
            last_name: last,
            suffix,
            nickname,
            party: partyCode(parties[i]),
            role,
            district: String(districts[i]),
        });
    }
    return out;
}

function buildUpserts(rows) {
    const lines = [];
    for (const r of rows) {
        lines.push(
            'INSERT INTO legislators (people_id, first_name, middle_name, last_name, suffix, nickname, party, role, district, active) VALUES (' +
            [
                r.people_id,
                escSql(r.first_name),
                escSql(r.middle_name),
                escSql(r.last_name),
                escSql(r.suffix),
                escSql(r.nickname),
                escSql(r.party),
                escSql(r.role),
                escSql(r.district),
                1,
            ].join(', ') +
            ') ON CONFLICT(people_id) DO UPDATE SET ' +
            'first_name=excluded.first_name, middle_name=excluded.middle_name, last_name=excluded.last_name, ' +
            'suffix=excluded.suffix, nickname=excluded.nickname, party=excluded.party, ' +
            'role=excluded.role, district=excluded.district, active=1;'
        );
    }
    return lines.join('\n');
}

const senateHtml = await fetchText(SENATE_URL);
const senators = extractRoster(senateHtml, {
    idAttr: /smembers\.aspx\?ID=(\d+)/.source,
    namePattern: /id="body_ListView11_LASTFIRSTLabel_\d+">([^<]+)</.source,
    districtPattern: /id="body_ListView11_DISTRICTNUMBERLabel1_\d+">(\d+)</.source,
    partyPattern: /id="body_ListView11_PARTYAFFILIATIONLabel1_\d+">([^<]+)</.source,
    chamberCode: 1,
    role: 'Sen',
});

const houseHtml = await fetchText(HOUSE_URL);
const reps = extractRoster(houseHtml, {
    idAttr: /\/H_Reps\/members\.aspx\?ID=(\d+)/.source,
    namePattern: /id="body_ListView1w2_LASTFIRSTLabel_\d+">([^<]+)</.source,
    districtPattern: /id="body_ListView1w2_DISTRICTNUMBERLabelw_\d+">(\d+)</.source,
    partyPattern: /id="body_ListView1w2_PARTYAFFILIATIONLabelw_\d+">([^<]+)</.source,
    chamberCode: 2,
    role: 'Rep',
});

console.error(`Senate: ${senators.length} members. House: ${reps.length} members.`);

const sql = [
    '-- Scraped from senate.la.gov + house.louisiana.gov',
    `-- ${new Date().toISOString()}`,
    buildUpserts(senators),
    buildUpserts(reps),
].join('\n');

const outPath = process.argv[2] ?? '/tmp/rosters.sql';
writeFileSync(outPath, sql);
console.error(`Wrote ${outPath}`);
