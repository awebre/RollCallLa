#!/usr/bin/env node
// Scrape committee roll-call votes from legis.la.gov CommitteeVote.aspx.
//
// Reads the moi worklist produced by scrape-bill-referrals.mjs, fetches each
// CommitteeVote.aspx page, finds the final-motion vote, matches legislators,
// and emits SQL for committee_roll_calls + committee_roll_call_votes.
//
// Only the final motion (Motion (Final):) is recorded per moi.  If a meeting
// has no final motion (all procedural), it is skipped.
//
// Usage:
//   node scripts/scrape-committee-votes.mjs 26RS
//   node scripts/scrape-committee-votes.mjs 26RS --moi 981182              # single moi
//   node scripts/scrape-committee-votes.mjs 26RS --moi-list /tmp/m.json    # explicit list
//   node scripts/scrape-committee-votes.mjs 26RS --out /tmp/cvotes.sql

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
    if (a === '--moi')      flags.moi     = Number(args[++i]);
    else if (a === '--moi-list') flags.moiList = args[++i];
    else if (a === '--out') flags.out     = args[++i];
    else if (a === '--limit') flags.limit = Number(args[++i]);
    else if (!a.startsWith('-')) SESSION = a;
}
const OUT_PATH     = flags.out     ?? '/tmp/committee_votes.sql';
const MOI_LIST_IN  = flags.moiList ?? '/tmp/moi-list.json';
const SESSION_YEAR = parseSession(SESSION).year;

const UA       = 'Mozilla/5.0 (la-vote-tracker scraper; civic data project)';
const PAUSE_MS = 150;
const CACHE_DIR = join(ROOT, '.scrape-cache', SESSION, 'committee-votes');
mkdirSync(CACHE_DIR, { recursive: true });

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

// ── load worklist ─────────────────────────────────────────────────────────────
let moiList;
if (flags.moi) {
    moiList = [{ moi: flags.moi, billNumber: null, sessionName: SESSION }];
} else if (existsSync(MOI_LIST_IN)) {
    moiList = JSON.parse(readFileSync(MOI_LIST_IN, 'utf8'));
} else {
    console.error(`No moi worklist found at ${MOI_LIST_IN}. Run scrape-bill-referrals.mjs first.`);
    process.exit(1);
}
if (flags.limit) moiList = moiList.slice(0, flags.limit);
console.error(`Processing ${moiList.length} moi entries.`);

// ── load legislators (for name matching) ─────────────────────────────────────
console.error('Loading legislators...');
const rosterRaw = runD1(
    `SELECT l.id, l.chamber, l.last_name, l.first_name, l.source_id
     FROM legislators l
     JOIN legislator_sessions ls ON ls.legislator_id = l.id
     WHERE ls.session_name = '${SESSION}' AND l.source = 'roster'`,
);
console.error(`Loaded ${rosterRaw.length} roster members.`);

function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// chamber → normalized last_name → [legislator rows]
const byLast = { H: new Map(), S: new Map() };
for (const l of rosterRaw) {
    if (!byLast[l.chamber]) continue;
    const key = norm(l.last_name);
    if (!byLast[l.chamber].has(key)) byLast[l.chamber].set(key, []);
    byLast[l.chamber].get(key).push(l);
}

function matchLegislator(fullName, chamber) {
    // fullName: "Last, First Middle" or "Last, Sr., First" etc.
    // Split at first comma for last name
    const commaIdx = fullName.indexOf(',');
    const last  = commaIdx >= 0 ? fullName.slice(0, commaIdx).trim() : fullName.trim();
    const rest  = commaIdx >= 0 ? fullName.slice(commaIdx + 1).trim() : '';
    // rest may be "Sr., Peter F." or just "Jack" — extract first initial
    const firstInitial = rest.replace(/^(?:[A-Z][a-z]*\.,?\s*)*/, '').replace(/[^A-Za-z].*$/, '').slice(0, 1).toUpperCase() || null;

    const ch = byLast[chamber];
    if (!ch) return null;
    const candidates = ch.get(norm(last));
    if (!candidates || candidates.length === 0) return null;
    if (candidates.length === 1) return candidates[0];
    if (firstInitial) {
        const hit = candidates.find((l) => l.first_name?.toUpperCase().startsWith(firstInitial));
        if (hit) return hit;
    }
    return null; // ambiguous
}

// ── load committees (for name→id) ─────────────────────────────────────────────
const committeeRows = runD1(`SELECT id, chamber, name FROM committees`);
function normalizeCommitteeName(name) {
    return name.toLowerCase().replace(/\s*&\s*/g, ' and ').replace(/,\s*and\b/g, ' and').replace(/\s+/g, ' ').trim();
}
const exactMap = new Map();
for (const c of committeeRows) {
    exactMap.set(`${c.chamber}:${normalizeCommitteeName(c.name)}`, c.id);
}
function matchCommittee(rawName, chamber) {
    const norm2 = normalizeCommitteeName(rawName);
    const exact = exactMap.get(`${chamber}:${norm2}`);
    if (exact != null) return exact;
    for (const c of committeeRows) {
        if (c.chamber !== chamber) continue;
        const dbNorm = normalizeCommitteeName(c.name);
        if (norm2.startsWith(dbNorm) || dbNorm.startsWith(norm2)) return c.id;
    }
    return null;
}

// ── load existing moi records (to skip already-parsed) ───────────────────────
const existingMois = new Set(
    runD1(`SELECT moi FROM committee_roll_calls`).map((r) => r.moi),
);
console.error(`${existingMois.size} moi already in DB; will skip those.`);

// ── fetch + parse ─────────────────────────────────────────────────────────────
async function cachedFetch(moi) {
    const cachePath = join(CACHE_DIR, `${moi}.html`);
    if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
    const url = `https://legis.la.gov/legis/CommitteeVote.aspx?moi=${moi}`;
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} → ${res.status}`);
    const text = await res.text();
    writeFileSync(cachePath, text);
    await sleep(PAUSE_MS);
    return text;
}

function decode(s) {
    return s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ')
        .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

// Month name → zero-padded number
const MONTHS = { january:'01',february:'02',march:'03',april:'04',may:'05',june:'06',
    july:'07',august:'08',september:'09',october:'10',november:'11',december:'12' };

function parseDate(raw) {
    // "April     13, 2026" or "March     18, 2026"
    const m = raw.trim().match(/^(\w+)\s+(\d+),\s+(\d{4})$/);
    if (!m) return null;
    const mon = MONTHS[m[1].toLowerCase()];
    if (!mon) return null;
    return `${m[3]}-${mon}-${m[2].padStart(2, '0')}`;
}

// Parse the divData content of CommitteeVote.aspx
function parseCommitteeVotePage(html) {
    const divMatch = html.match(/<div[^>]*id="ctl00_PageBody_divData"[^>]*>([\s\S]*?)<\/div>/i);
    if (!divMatch) return null;
    const content = divMatch[1];

    // Header: "<h4>2026 Regular Session<br>House Committee on Appropriations<br>April     13, 2026<br><br>HB1 by MCFARLAND</h4>"
    const headerMatch = content.match(/<h4>([\s\S]*?)<\/h4>/i);
    if (!headerMatch) return null;
    const headerParts = headerMatch[1].split(/<br\s*\/?>/i).map((p) => decode(p).trim()).filter(Boolean);
    // [0] = "2026 Regular Session"
    // [1] = "House Committee on Appropriations" or "Senate Committee on Finance"
    // [2] = "April     13, 2026"
    // [3] = "" (empty from double <br>)
    // [4] = "HB1 by MCFARLAND"
    if (headerParts.length < 3) return null;

    const chamberLine = headerParts[1]; // "House Committee on Appropriations"
    const chamberM = chamberLine.match(/^(House|Senate)\s+Committee\s+on\s+(.+)$/i);
    if (!chamberM) return null;
    const chamber = chamberM[1].toLowerCase() === 'house' ? 'H' : 'S';
    const committeeName = chamberM[2].trim();

    const dateStr = parseDate(headerParts[2]);
    if (!dateStr) return null;

    // Bill number: "HB1 by MCFARLAND" → "HB1"
    const billLine = headerParts.find((p) => /\bby\b/i.test(p));
    const billNumber = billLine ? billLine.split(/\s+by\s+/i)[0].trim() : null;

    // Find the final action: "<h4>Final action: With Amendments (18-0)</h4>"
    const finalActionM = content.match(/<h4>Final\s+action:\s*([\s\S]*?)<\/h4>/i);
    if (!finalActionM) return null; // no final action → skip
    const finalActionText = decode(finalActionM[1]).trim();

    // Parse vote count from final action text, e.g. "(18-0)" or "(8-0)"
    const countM = finalActionText.match(/\((\d+)-(\d+)(?:-(\d+))?\)/);
    const yea    = countM ? Number(countM[1]) : 0;
    const nay    = countM ? Number(countM[2]) : 0;
    const passed = yea > nay ? 1 : 0;

    // Find the final motion's <table class="tmotion"> / <table class="tvote"> pair.
    // The final motion contains "Motion (Final):" label.
    // Extract all <table class="touter"> blocks and find the one with "Motion (Final):"
    const outerRe = /<table\s+class="touter">([\s\S]*?)<\/table>\s*(?=<tr|<h4|<\/table|$)/gi;
    let outerM;
    let finalMotionBlock = null;
    while ((outerM = outerRe.exec(content)) !== null) {
        if (/Motion\s*\(Final\)/i.test(outerM[1])) {
            finalMotionBlock = outerM[1];
            break;
        }
    }
    if (!finalMotionBlock) return null; // no final motion block found

    // Parse individual votes from tvote table inside the final motion block
    const votes = []; // { name, voteLabel }
    const tvoteM = finalMotionBlock.match(/<table\s+class="tvote">([\s\S]*?)<\/table>/i);
    if (tvoteM) {
        const rowRe = /<tr>([\s\S]*?)<\/tr>/gi;
        let rM;
        while ((rM = rowRe.exec(tvoteM[1])) !== null) {
            const cells = [];
            const cellRe = /<td[^>]*>([\s\S]*?)<\/td>/gi;
            let cM;
            while ((cM = cellRe.exec(rM[1])) !== null) {
                cells.push(decode(cM[1]));
            }
            if (cells.length >= 2) {
                votes.push({ name: cells[0].trim(), voteLabel: cells[1].trim() });
            }
        }
    }

    // Tally from tvote (in case the header count is off)
    const tallies = { yea: 0, nay: 0, abstain: 0, absent: 0 };
    const voteValues = []; // { name, vote (integer 1-4) }
    for (const v of votes) {
        const label = v.voteLabel.toLowerCase();
        let voteInt;
        if (label === 'yea')                            { voteInt = 1; tallies.yea++; }
        else if (label === 'nay')                       { voteInt = 2; tallies.nay++; }
        else if (label === 'abstain' || label === 'not voting' || label === 'nv') { voteInt = 3; tallies.abstain++; }
        else if (label === 'absent')                    { voteInt = 4; tallies.absent++; }
        else { voteInt = 4; tallies.absent++; } // unknown → absent
        voteValues.push({ name: v.name, vote: voteInt });
    }

    return {
        chamber,
        committeeName,
        date: dateStr,
        billNumber,
        description: finalActionText.replace(/\s*\(\d+-\d+[^)]*\)/, '').trim(),
        yea:    tallies.yea    || yea,
        nay:    tallies.nay    || nay,
        abstain: tallies.abstain,
        absent:  tallies.absent,
        passed,
        voteValues,
    };
}

// ── output helpers ────────────────────────────────────────────────────────────
function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

function rollCallIdExpr(moi) {
    return `(SELECT id FROM committee_roll_calls WHERE moi=${moi})`;
}

// ── main loop ─────────────────────────────────────────────────────────────────
const sqlChunks = [
    `-- scrape-committee-votes output for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `-- D1 remote rejects BEGIN/COMMIT; each statement runs in its own transaction`,
];
const sessionIdExpr = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;

const stats = { processed: 0, skipped: 0, noFinal: 0, unmatched: [], votes: 0 };

// Deduplicate moi list
const seenMois = new Set();
for (const entry of moiList) {
    const moi = entry.moi;
    if (seenMois.has(moi)) continue;
    seenMois.add(moi);

    if (existingMois.has(moi)) { stats.skipped++; continue; }

    let html;
    try {
        html = await cachedFetch(moi);
    } catch (e) {
        console.error(`moi=${moi}: fetch failed: ${e.message}`);
        continue;
    }

    const parsed = parseCommitteeVotePage(html);
    if (!parsed) {
        stats.noFinal++;
        continue;
    }

    const committeeId = matchCommittee(parsed.committeeName, parsed.chamber);
    if (committeeId == null) {
        stats.unmatched.push(`moi=${moi} ${parsed.chamber} "${parsed.committeeName}"`);
        continue;
    }

    const billIdExpr = parsed.billNumber
        ? `(SELECT id FROM bills WHERE session_name=${escSql(SESSION)} AND bill_number=${escSql(parsed.billNumber)})`
        : 'NULL';

    sqlChunks.push(
        `INSERT INTO committee_roll_calls (moi, committee_id, bill_id, session_id, date, description, yea, nay, abstain, absent, passed) VALUES (${moi}, ${committeeId}, ${billIdExpr}, ${sessionIdExpr}, ${escSql(parsed.date)}, ${escSql(parsed.description)}, ${parsed.yea}, ${parsed.nay}, ${parsed.abstain}, ${parsed.absent}, ${parsed.passed}) ON CONFLICT(moi) DO NOTHING;`,
    );

    for (const v of parsed.voteValues) {
        const legislator = matchLegislator(v.name, parsed.chamber);
        if (!legislator) {
            stats.unmatched.push(`moi=${moi} name="${v.name}" (${parsed.chamber})`);
            continue;
        }
        sqlChunks.push(
            `INSERT INTO committee_roll_call_votes (roll_call_id, legislator_id, vote) VALUES (${rollCallIdExpr(moi)}, ${legislator.id}, ${v.vote}) ON CONFLICT(roll_call_id, legislator_id) DO UPDATE SET vote=excluded.vote;`,
        );
        stats.votes++;
    }

    stats.processed++;
    if (stats.processed % 50 === 0) console.error(`  processed ${stats.processed} moi entries...`);
}

sqlChunks.push('-- end batch');
writeFileSync(OUT_PATH, sqlChunks.join('\n'));

console.error(`Wrote ${OUT_PATH}`);
console.error(`Processed: ${stats.processed}  Skipped (already in DB): ${stats.skipped}  No-final-motion: ${stats.noFinal}`);
console.error(`Votes recorded: ${stats.votes}`);
if (stats.unmatched.length > 0) {
    console.error(`Unmatched (${stats.unmatched.length}):`);
    for (const u of stats.unmatched.slice(0, 20)) console.error(`  ${u}`);
}
