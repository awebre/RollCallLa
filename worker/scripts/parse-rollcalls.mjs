#!/usr/bin/env node
// Parse roll-call PDFs from legis.la.gov, extract per-member votes, and emit
// SQL that fills in `votes` rows and updates `roll_calls` with tallies/date.
//
// PDFs are downloaded by `pdf_doc_id` (already populated on `roll_calls`) and
// cached at `.scrape-cache/<sid>/pdfs/<doc_id>.pdf`.
//
// Usage:
//   node --experimental-strip-types scripts/parse-rollcalls.mjs                 # all 24RS roll calls
//   node --experimental-strip-types scripts/parse-rollcalls.mjs --limit 5       # smoke test
//   node --experimental-strip-types scripts/parse-rollcalls.mjs --doc 1369388   # single PDF

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

import { PDFParse } from 'pdf-parse';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

const SESSION = '24RS';
const CACHE_DIR = join(ROOT, '.scrape-cache', SESSION, 'pdfs');
mkdirSync(CACHE_DIR, { recursive: true });

const UA = 'Mozilla/5.0 (la-vote-tracker pdf fetcher; civic data project)';
const PAUSE_MS = 150;

// Chamber leadership for 24RS (PDFs use "Mr. Speaker" / "Mr. President" for the chair).
// These need to be looked up by hand per session since the rosters don't expose them.
// House: Phillip DeVillier (R-41). Senate: Cameron Henry (R-9). Pro Tem: Regina Barrow (D-15).
const LEADERSHIP_24RS = {
    'Mr. Speaker':              { chamber: 'H', last: 'DeVillier' },
    'Mr. President':            { chamber: 'S', last: 'Henry' },
    'Madam President Pro Tem':  { chamber: 'S', last: 'Barrow' },
    'Mr. President Pro Tem':    { chamber: 'S', last: 'Barrow' },
};

const args = process.argv.slice(2);
const flags = {};
for (let i = 0; i < args.length; i++) {
    if (args[i] === '--limit') flags.limit = Number(args[++i]);
    else if (args[i] === '--doc') flags.doc = Number(args[++i]);
}

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

function runD1(cmd) {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'DB', '--local', '--command', cmd, '--json'], {
        cwd: ROOT,
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    // Wrangler prints banner + JSON. Extract JSON from "[" onward.
    const jsonStart = out.indexOf('\n[');
    const json = JSON.parse(out.slice(jsonStart === -1 ? out.indexOf('[') : jsonStart + 1));
    return json[0]?.results ?? [];
}

console.error('Loading legislators...');
const legislatorsRaw = runD1(
    `SELECT people_id, first_name, last_name, role FROM legislators WHERE active = 1`,
);

// Normalize for matching: lowercase + strip diacritics. PDFs use ASCII; the roster has
// "Amedée" / "Gallé" / "DeWitt" — these all need to fold together.
function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// Build chamber-scoped lookups by *normalized* last name. Senate is unique on last_name;
// House has dupes that PDFs disambiguate with a "Last, X." (first-initial) suffix.
const byChamberLast = { H: new Map(), S: new Map() };
for (const l of legislatorsRaw) {
    const chamber = l.role === 'Sen' ? 'S' : 'H';
    const map = byChamberLast[chamber];
    const key = norm(l.last_name);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(l);
}

// Sorted list of known *normalized* last names per chamber (longest first) for greedy
// multi-name line splitting (some Senate PDFs collapse two members onto one line).
const sortedLasts = {
    H: [...byChamberLast.H.keys()].sort((a, b) => b.length - a.length),
    S: [...byChamberLast.S.keys()].sort((a, b) => b.length - a.length),
};

console.error(`Loaded ${legislatorsRaw.length} legislators.`);

console.error('Loading roll calls...');
let where = `pdf_doc_id IS NOT NULL`;
if (flags.doc) where += ` AND pdf_doc_id = ${flags.doc}`;
const limit = flags.limit ? `LIMIT ${flags.limit}` : '';
const rollCalls = runD1(
    `SELECT roll_call_id, chamber, pdf_doc_id, description FROM roll_calls WHERE ${where} ORDER BY roll_call_id ${limit}`,
);
console.error(`Will parse ${rollCalls.length} roll calls.`);

async function fetchPdf(docId) {
    const cachePath = join(CACHE_DIR, `${docId}.pdf`);
    if (existsSync(cachePath)) return readFileSync(cachePath);
    const res = await fetch(`https://legis.la.gov/legis/ViewDocument.aspx?d=${docId}`, {
        headers: { 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`PDF ${docId} -> ${res.status}`);
    const buf = Buffer.from(await res.arrayBuffer());
    writeFileSync(cachePath, buf);
    await sleep(PAUSE_MS);
    return buf;
}

async function parsePdf(buf) {
    const parser = new PDFParse({ data: new Uint8Array(buf) });
    const { text } = await parser.getText();
    return text;
}

const SECTION_RE = /^(YEAS|NAYS|ABSENT|NOT\s+VOTING|NV)\.?$/i;
const SECTION_VOTE = { YEAS: 1, NAYS: 2, NV: 3, 'NOT VOTING': 3, ABSENT: 4 };

function extractDate(text) {
    const m = text.match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

// Leadership tokens that PDFs glue at the start of a column-collapsed line.
// We need to peel them off as their own name before falling through to last-name matching.
const LEADERSHIP_PREFIXES = [
    'Madam President Pro Tem',
    'Mr. President Pro Tem',
    'Mr. President',
    'Mr. Speaker',
];

function splitMultiNameLine(line, chamber) {
    // Senate PDFs pack two or three members on one line via column collapse. Peel names
    // off greedily: try leadership prefix → known last name → single-token fallback.
    //
    // The fallback case matters when the *first* name on a line is a departed legislator
    // not in our current roster (e.g. "Coussan Harris" — Coussan left, Harris is current).
    // Without this, we'd consume the whole line as one synthetic and miss Harris's vote.
    const lasts = sortedLasts[chamber];
    const out = [];
    let remaining = line.trim();
    while (remaining.length > 0) {
        let matched = false;

        for (const prefix of LEADERSHIP_PREFIXES) {
            if (remaining === prefix || remaining.startsWith(prefix + ' ')) {
                out.push(prefix);
                remaining = remaining.slice(prefix.length).trim();
                matched = true;
                break;
            }
        }
        if (matched) continue;

        const normRemaining = norm(remaining);
        for (const last of lasts) {
            // Optional ", X." disambiguator follows the last name (e.g. "Carter, R.").
            const re = new RegExp(`^${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,\\s*[a-z]\\.?)?(?=\\s|$)`);
            const m = normRemaining.match(re);
            if (m) {
                out.push(remaining.slice(0, m[0].length));
                remaining = remaining.slice(m[0].length).trim();
                matched = true;
                break;
            }
        }
        if (matched) continue;

        // No known prefix matches at the head. Peel a single token (with optional
        // ", X." disambiguator) and emit it as an unknown name — lookupMember will
        // mint a synthetic. The remainder gets re-processed on the next iteration so
        // a known name later in the line still maps to the right person.
        const tokMatch = remaining.match(/^(\S+(?:,\s*[A-Za-z]\.?)?)/);
        if (!tokMatch) break;
        out.push(tokMatch[1]);
        remaining = remaining.slice(tokMatch[0].length).trim();
    }
    return out;
}

// Does any whitespace-separated token of the first name start with this initial?
// Covers cases like first_name "C. Travis" paired with PDF disambig "Johnson, T."
// — the matcher needs to look past the leading "C." to find Travis.
function firstNameHasInitial(firstName, initial) {
    const want = initial.toUpperCase();
    for (const tok of firstName.split(/\s+/)) {
        const clean = tok.replace(/^[^A-Za-z]+/, ''); // strip leading "." or "C."
        if (clean.toUpperCase().startsWith(want)) return true;
    }
    return false;
}

function lookupMember(name, chamber) {
    const leader = LEADERSHIP_24RS[name];
    if (leader) {
        const map = byChamberLast[leader.chamber];
        return map.get(norm(leader.last))?.[0] ?? null;
    }
    // Disambiguator? "Carter, R." -> last="Carter", initial="R"
    const disambig = name.match(/^(.+?),\s*([A-Za-z])\.?$/);
    const last = disambig ? disambig[1].trim() : name.trim();
    const initial = disambig?.[2] ?? null;
    const arr = byChamberLast[chamber].get(norm(last));
    if (!arr) return null;
    if (arr.length === 1) return arr[0];
    if (initial) {
        const hit = arr.find((l) => firstNameHasInitial(l.first_name, initial));
        if (hit) return hit;
    }
    return null; // ambiguous
}

// For unmatched names (rep who left office between session and now), we mint a
// synthetic legislator row so the vote isn't lost. Keyed by (chamber, normalized last).
// Synthetic people_ids: 900000 + sequential index — far away from the chamber-based
// IDs used by the live roster scraper (10xxx, 20xxx).
const syntheticByKey = new Map();
const syntheticInserts = [];
function mintSynthetic(chamber, displayName, normKey) {
    if (syntheticByKey.has(normKey)) return syntheticByKey.get(normKey);
    const id = 900_000 + syntheticByKey.size + 1;
    syntheticByKey.set(normKey, id);
    // Strip any ", X." disambiguator from the display form.
    const cleanLast = displayName.replace(/,\s*[A-Za-z]\.?\s*$/, '').trim();
    syntheticInserts.push(
        `INSERT INTO legislators (people_id, first_name, last_name, role, active) VALUES (${id}, '', ${escSql(cleanLast)}, ${escSql(chamber === 'S' ? 'Sen' : 'Rep')}, 0) ON CONFLICT(people_id) DO UPDATE SET last_name=excluded.last_name, role=excluded.role;`,
    );
    return id;
}

const sqlChunks = [];
const stats = { roll_calls: 0, votes: 0, unmatched: new Map(), synthetic: 0 };

for (const rc of rollCalls) {
    let buf;
    try {
        buf = await fetchPdf(rc.pdf_doc_id);
    } catch (e) {
        console.error(`fetch ${rc.pdf_doc_id} failed: ${e.message}`);
        continue;
    }
    let text;
    try {
        text = await parsePdf(buf);
    } catch (e) {
        console.error(`parse ${rc.pdf_doc_id} failed: ${e.message}`);
        continue;
    }

    const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
    const tallies = { 1: 0, 2: 0, 3: 0, 4: 0 };
    const voters = []; // { people_id, vote }
    let currentVote = null;

    for (const line of lines) {
        const sec = line.match(SECTION_RE);
        if (sec) {
            const key = sec[1].toUpperCase().replace(/\s+/g, ' ');
            currentVote = SECTION_VOTE[key] ?? null;
            continue;
        }
        if (/^Total\s*--\s*\d+/i.test(line)) {
            currentVote = null;
            continue;
        }
        if (currentVote === null) continue;
        // Skip footer markers like "-- 1 of 1 --"
        if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

        const names = splitMultiNameLine(line, rc.chamber);
        for (const name of names) {
            const member = lookupMember(name, rc.chamber);
            let peopleId;
            if (member) {
                peopleId = member.people_id;
            } else {
                // Mint a synthetic legislator keyed on (chamber, normalized name with optional initial)
                // so the same departed-rep collapses to one row across the whole session.
                stats.unmatched.set(name, (stats.unmatched.get(name) || 0) + 1);
                const key = `${rc.chamber}:${norm(name)}`;
                peopleId = mintSynthetic(rc.chamber, name, key);
                stats.synthetic++;
            }
            voters.push({ people_id: peopleId, vote: currentVote });
            tallies[currentVote]++;
        }
    }

    const date = extractDate(text) ?? '1970-01-01';
    const yea = tallies[1], nay = tallies[2], nv = tallies[3], absent = tallies[4];
    const total = yea + nay + nv + absent;
    const passed = yea > nay ? 1 : 0;
    const margin = Math.abs(yea - nay);

    sqlChunks.push(
        `UPDATE roll_calls SET date=${escSql(date)}, yea=${yea}, nay=${nay}, nv=${nv}, absent=${absent}, total=${total}, passed=${passed}, margin=${margin} WHERE roll_call_id=${rc.roll_call_id};`,
    );
    // Replace any existing votes for this roll call (idempotent + simpler than diffing).
    sqlChunks.push(`DELETE FROM votes WHERE roll_call_id=${rc.roll_call_id};`);
    for (const v of voters) {
        sqlChunks.push(
            `INSERT INTO votes (roll_call_id, people_id, vote) VALUES (${rc.roll_call_id}, ${v.people_id}, ${v.vote});`,
        );
    }

    stats.roll_calls++;
    stats.votes += voters.length;
}

const outPath = '/tmp/rollcall_votes.sql';
// Synthetic legislator inserts must run before any votes that reference them.
writeFileSync(outPath, [...syntheticInserts, ...sqlChunks].join('\n'));
console.error(`Synthetic legislators created: ${syntheticByKey.size}`);
console.error(`Wrote ${outPath}`);
console.error(`Roll calls parsed: ${stats.roll_calls}`);
console.error(`Votes recorded: ${stats.votes}`);

// Print top unmatched names so we can see categorizer/leadership gaps.
const top = [...stats.unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
if (top.length > 0) {
    console.error('Top unmatched names:');
    for (const [name, n] of top) console.error(`  ${n}\t${name}`);
}
