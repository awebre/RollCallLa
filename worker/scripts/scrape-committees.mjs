#!/usr/bin/env node
// Scrape committee membership from house.louisiana.gov and senate.la.gov.
//
// Discovers H/S committees from the chamber websites directly (plain HTML nav).
// Misc/joint/select committees are discovered from legis.la.gov/Committees.aspx?c=m.
// No hardcoded committee lists — new committees are picked up automatically.
//
// Matching: each committee page links member names to their official profiles
// using the same source_id scheme as scrape-rosters.mjs
// (house.louisiana.gov: /H_Reps/members.aspx?ID=N,
//  senate.la.gov:       /smembers.aspx?ID=N).
// We resolve legislator_id via (chamber, source_id), so scrape-rosters must
// run first.
//
// Delete-then-insert per (committee_id, session_id) clears stale memberships
// (chair change, interim rotation, etc.) on every run.
//
// Usage:
//   node --experimental-strip-types scripts/scrape-committees.mjs [session] [outfile]
//   node --experimental-strip-types scripts/scrape-committees.mjs 26RS /tmp/committees.sql
//   npm run scrape:committees

import { writeFileSync } from 'node:fs';

const SESSION  = process.argv[2] ?? '26RS';
const OUT_PATH = process.argv[3] ?? '/tmp/committees.sql';

const UA = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';

// ── Discover H/S committees from chamber websites ────────────────────────────
// house.louisiana.gov and senate.la.gov are plain HTML, so href extraction
// works without a headless browser.  legis.la.gov/Committees.aspx?c=H/S uses
// ASP.NET JS-rendered navigation and is intentionally avoided here.
// Committee names are resolved from the individual committee pages at fetch time.
async function discoverChamberCommittees(chamber) {
    // House:  house.louisiana.gov/H_Cmtes/Standing.aspx  → absolute hrefs, full names in link text
    // Senate: senate.la.gov/CommitteesStanding.aspx       → relative hrefs, full names in link text
    const listingUrl = chamber === 'H'
        ? 'https://house.louisiana.gov/H_Cmtes/Standing.aspx'
        : 'https://senate.la.gov/CommitteesStanding.aspx';
    const baseUrl = chamber === 'H'
        ? 'https://house.louisiana.gov'
        : 'https://senate.la.gov';
    const linkRe = chamber === 'H'
        ? /<a\s[^>]*href="(https?:\/\/house\.louisiana\.gov\/H_Cmtes\/([A-Za-z][A-Za-z0-9]+)\.aspx)"[^>]*>([\s\S]{1,300}?)<\/a>/gi
        : /<a\s[^>]*href="(Sen_Committees\/([A-Za-z][A-Za-z0-9]+)\.aspx)"[^>]*>([\s\S]{1,300}?)<\/a>/gi;

    const html = await fetchText(listingUrl);
    const seen = new Set();
    const found = [];
    let m;
    while ((m = linkRe.exec(html)) !== null) {
        const [, href, segment, linkHtml] = m;
        const slug = toSlug(segment);
        if (seen.has(slug)) continue;
        seen.add(slug);
        const url = href.startsWith('http') ? href : `${baseUrl}/${href}`;
        const name = cleanText(linkHtml) || null;
        found.push({ slug, url, chamber, name });
    }

    if (found.length < 5) {
        console.error(`  [warn] Only ${found.length} ${chamber} committees discovered — check ${listingUrl}`);
    } else {
        console.error(`  Found ${found.length} ${chamber === 'H' ? 'House' : 'Senate'} committees`);
    }
    return found;
}

// Dynamic discovery only for misc/joint/select committees — these use plain
// hrefs on legis.la.gov so the regex works.
const MISC_INDEX_URL = 'https://legis.la.gov/legis/Committees.aspx?c=m';

async function fetchText(url) {
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.text();
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
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

// "CriminalJustice"  → "criminal-justice"
// "HouseAndGov"      → "house-and-gov"
// "WaysAndMeans"     → "ways-and-means"
// "JudiciaryA"       → "judiciary-a"
// "Finance"          → "finance"
function toSlug(pathSegment) {
    return pathSegment
        .replace(/\.aspx$/i, '')
        .replace(/([A-Z])/g, '-$1')
        .toLowerCase()
        .replace(/^-/, '');
}

// Extract committee name from link text (strip HTML tags, decode entities).
function cleanText(raw) {
    return decode(raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
}

// ── Discover misc/joint/select committees from the legis.la.gov misc index ───
// These committees are hosted on legis.la.gov itself with plain href attributes,
// so regex discovery works.  Standing H/S committees use JS-rendered navigation
// and are hardcoded above instead.
function discoverCommitteesFromIndex(html, chamberOverride) {
    const found = [];
    const legisRe = /href="(https?:\/\/legis\.la\.gov\/legis\/Committee\.aspx[^"]+)"[^>]*>([^<]+)</gi;
    let m;
    while ((m = legisRe.exec(html)) !== null) {
        const url  = m[1];
        const slug = toSlug(url.replace(/.*[?&]CM=/, '').split('&')[0] || 'misc');
        const name = cleanText(m[2]);
        if (name) found.push({ url, slug, name, chamber: chamberOverride ?? 'J' });
    }
    return found;
}

// Extract committee name from a committee page's heading or title tag.
function parseCommitteeName(html) {
    const heading = html.match(/<h[123][^>]*>([^<]{10,120})<\/h[123]>/i);
    if (heading) return cleanText(heading[1]);
    const title = html.match(/<title>([^<]+)<\/title>/i);
    if (title) return cleanText(title[1].split(/\s*[-|–—]\s*/)[0]);
    return null;
}

// ── Parse member source_ids and roles from a committee page ──────────────────
// Both house.louisiana.gov and senate.la.gov link member names to their profile
// pages using the same IDs used by the roster pages:
//   House:  /H_Reps/members.aspx?ID=<source_id>
//   Senate: /smembers.aspx?ID=<source_id>
//
// We walk through the HTML finding each member link, then extract a role from
// the surrounding text (≤300 chars after the opening of the link's enclosing
// row/item element).  Order of detection matters — check longest phrases first.
function parseMembersFromPage(html, chamberHint) {
    const members = [];

    // Pattern: find each member link and capture a window of surrounding HTML.
    // We split the full HTML into "segments" at each member link so we can
    // inspect the text that immediately follows each one (up to the next link).
    const houseIdRe  = /\/H_Reps\/members\.aspx\?ID=(\d+)/gi;
    const senateIdRe = /\/smembers\.aspx\?ID=(\d+)/gi;

    // Pick the right regex based on what the URL pattern of the page tells us,
    // with a fallback heuristic: count which pattern has more matches.
    const houseMatches  = [...html.matchAll(new RegExp(houseIdRe.source,  'gi'))];
    const senateMatches = [...html.matchAll(new RegExp(senateIdRe.source, 'gi'))];

    let chamber;
    let idRe;
    if (houseMatches.length >= senateMatches.length && houseMatches.length > 0) {
        chamber = 'H';
        idRe = new RegExp(houseIdRe.source, 'gi');
    } else if (senateMatches.length > 0) {
        chamber = 'S';
        idRe = new RegExp(senateIdRe.source, 'gi');
    } else {
        // No member links found — page may be empty or have a different structure.
        console.error(`  [warn] No member links found on page`);
        return [];
    }

    // Collect all match positions (deduplicated by source_id since some pages
    // render each member link twice — once for the photo, once for the name).
    const seen = new Set();
    const positions = [];
    let match;
    while ((match = idRe.exec(html)) !== null) {
        const sourceId = Number(match[1]);
        if (seen.has(sourceId)) continue;
        seen.add(sourceId);
        positions.push({ sourceId, index: match.index });
    }

    for (let i = 0; i < positions.length; i++) {
        const { sourceId, index } = positions[i];
        const nextIndex = i + 1 < positions.length ? positions[i + 1].index : Math.min(index + 600, html.length);
        // Extract window: from 200 chars before to the next member link.
        // The 200-char lookback catches role text that precedes the name link
        // in table layouts where role is in a prior <td>.
        const windowStart = Math.max(0, index - 200);
        const window = html.slice(windowStart, nextIndex);
        const role = extractRole(window);
        members.push({ sourceId, chamber, role });
    }

    return members;
}

function extractRole(contextHtml) {
    // Strip tags, decode entities, lower-case for matching.
    const text = contextHtml
        .replace(/<[^>]+>/g, ' ')
        .replace(/&amp;/g, '&')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .toLowerCase();

    // Longest / most-specific phrases first.
    if (text.includes('ex officio'))    return 'ex_officio';
    if (text.includes('vice chair'))    return 'vice_chair';
    if (text.includes('interim member')) return 'interim';
    if (text.includes('chair'))         return 'chair';
    return 'member';
}

// ── SQL helpers ──────────────────────────────────────────────────────────────
function committeeUpsert(c) {
    return (
        `INSERT INTO committees (slug, name, chamber, url) VALUES (` +
        [escSql(c.slug), escSql(c.name), escSql(c.chamber), escSql(c.url)].join(', ') +
        `) ON CONFLICT(chamber, slug) DO UPDATE SET name=excluded.name, url=excluded.url;`
    );
}

// Arrive: insert a new active membership row (valid_to NULL).
// ON CONFLICT on (committee_id, legislator_id, valid_from) is a no-op so
// re-running the same scrape twice on the same day is idempotent.
function membershipArrive(committeeSlug, chamber, sourceId, memberChamber, role, today) {
    const committeeIdExpr  = `(SELECT id FROM committees WHERE chamber=${escSql(chamber)} AND slug=${escSql(committeeSlug)})`;
    const legislatorIdExpr = `(SELECT id FROM legislators WHERE chamber=${escSql(memberChamber)} AND source_id=${sourceId})`;
    const sessionIdExpr    = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
    return (
        `INSERT OR IGNORE INTO committee_memberships` +
        ` (committee_id, legislator_id, session_id, role, valid_from, valid_to) VALUES (` +
        [committeeIdExpr, legislatorIdExpr, sessionIdExpr, escSql(role), escSql(today), 'NULL'].join(', ') +
        `);`
    );
}

// Depart: close out any active row for a member no longer seen on the page.
// Sets valid_to only on rows where valid_to IS NULL (still active).
function membershipDepart(committeeSlug, chamber, sourceId, memberChamber, today) {
    const committeeIdExpr  = `(SELECT id FROM committees WHERE chamber=${escSql(chamber)} AND slug=${escSql(committeeSlug)})`;
    const legislatorIdExpr = `(SELECT id FROM legislators WHERE chamber=${escSql(memberChamber)} AND source_id=${sourceId})`;
    const sessionIdExpr    = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
    return (
        `UPDATE committee_memberships SET valid_to=${escSql(today)}` +
        ` WHERE committee_id=${committeeIdExpr}` +
        ` AND legislator_id=${legislatorIdExpr}` +
        ` AND session_id=${sessionIdExpr}` +
        ` AND valid_to IS NULL;`
    );
}

// ── Main ─────────────────────────────────────────────────────────────────────
const TODAY = new Date().toISOString().slice(0, 10); // 'YYYY-MM-DD'

// Discover all committees dynamically — no hardcoded lists.
console.error('Discovering House committees…');
const houseCommittees = await discoverChamberCommittees('H');
console.error('Discovering Senate committees…');
const senateCommittees = await discoverChamberCommittees('S');
const allCommittees = [...houseCommittees, ...senateCommittees];

// Misc/joint/select committees from the legis.la.gov index (plain hrefs).
console.error(`Fetching misc/joint index: ${MISC_INDEX_URL}`);
try {
    const miscHtml = await fetchText(MISC_INDEX_URL);
    const miscFound = discoverCommitteesFromIndex(miscHtml, 'J');
    console.error(`  Found ${miscFound.length} misc/joint committees`);
    allCommittees.push(...miscFound);
} catch (err) {
    console.error(`  [skip] ${err.message}`);
}

// Deduplicate by (chamber, slug) — misc index might overlap with standing lists.
const dedupMap = new Map();
for (const c of allCommittees) {
    const key = `${c.chamber}:${c.slug}`;
    if (!dedupMap.has(key)) dedupMap.set(key, c);
}
const committees = [...dedupMap.values()];
console.error(`Total committees to scrape: ${committees.length}`);

const sqlLines = [
    `-- Committee memberships for session ${SESSION} — scraped ${new Date().toISOString()}`,
    `-- Diff-based: arrivals get a new row (valid_from=${TODAY}),`,
    `-- departures get valid_to=${TODAY} on the open row.`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
];

let arrived = 0;
let departed = 0;
let unchanged = 0;
let skipped = 0;

for (const committee of committees) {
    console.error(`  Scraping ${committee.chamber} · ${committee.name}`);
    let html;
    try {
        html = await fetchText(committee.url);
    } catch (err) {
        console.error(`    [skip] ${err.message}`);
        skipped++;
        continue;
    }

    const members = parseMembersFromPage(html, committee.chamber);
    console.error(`    ${members.length} members found`);

    // Resolve name from the page if discovery didn't provide one (H/S committees).
    const resolvedName = committee.name ?? parseCommitteeName(html) ?? committee.slug;
    sqlLines.push(committeeUpsert({ ...committee, name: resolvedName }));

    // The scraper emits SQL — it cannot read back existing DB rows at emit time.
    // We use SQL-level logic: INSERT OR IGNORE for arrivals (idempotent if the
    // row already exists for today), UPDATE...WHERE valid_to IS NULL for
    // departures.  On the first run every member is an "arrival"; on subsequent
    // runs only genuine changes produce new rows.
    //
    // Departure detection: we need to close rows for members NOT in this scrape.
    // We do this with a single UPDATE that closes any active row whose
    // legislator_id is NOT among the scraped source_ids for this committee.
    // Build a subquery list of legislator ids present in the fresh scrape.

    if (members.length > 0) {
        const presentSubqueries = members
            .map(({ sourceId, chamber: mc }) =>
                `(SELECT id FROM legislators WHERE chamber=${escSql(mc)} AND source_id=${sourceId})`
            )
            .join(', ');

        const committeeIdExpr = `(SELECT id FROM committees WHERE chamber=${escSql(committee.chamber)} AND slug=${escSql(committee.slug)})`;
        const sessionIdExpr   = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;

        // Close active rows for members no longer present.
        sqlLines.push(
            `UPDATE committee_memberships SET valid_to=${escSql(TODAY)}` +
            ` WHERE committee_id=${committeeIdExpr}` +
            ` AND session_id=${sessionIdExpr}` +
            ` AND valid_to IS NULL` +
            ` AND legislator_id NOT IN (${presentSubqueries});`
        );

        // Arrive: insert for each member (idempotent via ON CONFLICT ignore).
        for (const { sourceId, chamber: memberChamber, role } of members) {
            sqlLines.push(membershipArrive(committee.slug, committee.chamber, sourceId, memberChamber, role, TODAY));
            arrived++;
        }
    } else {
        // Parsing produced nothing — don't close existing rows; treat as a scrape
        // failure rather than "everyone left" to avoid data loss on parse errors.
        console.error(`    [warn] No members parsed — skipping departure check`);
        skipped++;
    }
}

console.error(`Done. ${committees.length} committees: ${arrived} arrive rows, ${departed} depart rows, ${unchanged} unchanged, ${skipped} skipped.`);

writeFileSync(OUT_PATH, sqlLines.join('\n'));
console.error(`Wrote ${OUT_PATH}`);
