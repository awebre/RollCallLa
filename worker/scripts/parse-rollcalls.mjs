#!/usr/bin/env node
// Discover and parse roll-call PDFs from legis.la.gov for a session.
//
// Two-pass with scrape-bills.mjs:
//   scrape-bills writes `bills.docs_id`. This script uses that to:
//     1. Hit BillDocs.aspx?i=<docs_id>&t=votes per bill to discover PDFs.
//     2. Skip PDFs whose (chamber, session_name, rc_number) already exists in
//        roll_calls — that's the "already parsed" check (no shell rows, no
//        date sentinel, no re-parsing waste).
//     3. Fetch + parse each new PDF and emit SQL to insert the complete
//        roll_calls row + per-member votes in one shot.
//
// Output: SQL file containing legislator inserts (for pdf-only synthetics)
// followed by roll_calls + votes inserts using natural-key subqueries to resolve
// surrogate FK ids.
//
// Usage:
//   node --experimental-strip-types scripts/parse-rollcalls.mjs                 # default 24RS
//   node --experimental-strip-types scripts/parse-rollcalls.mjs 24RS            # explicit session
//   node --experimental-strip-types scripts/parse-rollcalls.mjs 24RS --limit 5  # smoke test
//   node --experimental-strip-types scripts/parse-rollcalls.mjs 24RS --doc 1369388  # single PDF

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as sleep } from 'node:timers/promises';

import { PDFParse } from 'pdf-parse';
import { parseVotePage } from '../src/worker/votepage.ts';
import { runD1 as runD1Raw } from './lib/d1.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

// ── CLI ───────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
let SESSION = '24RS';
const flags = {};
for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '--limit') flags.limit = Number(args[++i]);
    else if (a === '--doc') flags.doc = Number(args[++i]);
    else if (a === '--out')   flags.out = args[++i];
    else if (!a.startsWith('-')) SESSION = a;
}
const OUT_PATH = flags.out ?? '/tmp/rollcall_votes.sql';

const CACHE_DIR     = join(ROOT, '.scrape-cache', SESSION, 'pdfs');
const VOTES_CACHE   = join(ROOT, '.scrape-cache', SESSION, 'votes');
mkdirSync(CACHE_DIR, { recursive: true });
mkdirSync(VOTES_CACHE, { recursive: true });

const UA = 'Mozilla/5.0 (la-vote-tracker pdf fetcher; civic data project)';
const PAUSE_MS = 150;

// Chamber leadership — PDFs use "Mr. Speaker" / "Mr. President" for the chair.
// Looked up by hand per session since rosters don't expose this role.
// 24RS: House Speaker Phillip DeVillier (R-41); Senate President Cameron Henry (R-9);
//       Senate President Pro Tem Regina Barrow (D-15).
const LEADERSHIP_BY_SESSION = {
    '24RS': {
        'Mr. Speaker':              { chamber: 'H', last: 'DeVillier' },
        'Mr. President':            { chamber: 'S', last: 'Henry' },
        'Madam President Pro Tem':  { chamber: 'S', last: 'Barrow' },
        'Mr. President Pro Tem':    { chamber: 'S', last: 'Barrow' },
    },
};
const LEADERSHIP = LEADERSHIP_BY_SESSION[SESSION] ?? {};

function escSql(v) {
    if (v === null || v === undefined) return 'NULL';
    return `'${String(v).replace(/'/g, "''")}'`;
}

const runD1 = (cmd) => runD1Raw(cmd, { cwd: ROOT });

// ── load session members + pdf-only legislators ──────────────────────────────
console.error(`Loading legislators for session ${SESSION}...`);
const rosterRaw = runD1(
    `SELECT l.id, l.chamber, l.source_id, l.last_name, l.first_name,
            ls.role, ls.term_start, ls.term_end, ls.year_elected, ls.active
     FROM legislators l
     JOIN legislator_sessions ls ON ls.legislator_id = l.id
     WHERE ls.session_name = '${SESSION}' AND l.source = 'roster'`,
);
// Pdf-only legislators are global (not session-scoped) — same name carries across.
const pdfOnlyRaw = runD1(
    `SELECT id, chamber, last_name FROM legislators WHERE source = 'pdf'`,
);

function norm(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

// chamber → normalized last name → [legislator rows]
const byChamberLast = { H: new Map(), S: new Map() };
for (const l of rosterRaw) {
    const key = norm(l.last_name);
    if (!byChamberLast[l.chamber].has(key)) byChamberLast[l.chamber].set(key, []);
    byChamberLast[l.chamber].get(key).push(l);
}

const sortedLasts = {
    H: [...byChamberLast.H.keys()].sort((a, b) => b.length - a.length),
    S: [...byChamberLast.S.keys()].sort((a, b) => b.length - a.length),
};
console.error(`Loaded ${rosterRaw.length} session members + ${pdfOnlyRaw.length} pdf-only.`);

// ── load bills + existing roll_calls ─────────────────────────────────────────
let billsWhere = `b.session_name = '${SESSION}' AND b.docs_id IS NOT NULL`;
if (flags.doc) billsWhere += ` /* doc filter applied later */`;
const billsRaw = runD1(
    `SELECT b.id, b.bill_number, b.docs_id, b.originating_chamber
     FROM bills b
     WHERE ${billsWhere}
     ORDER BY b.bill_number`,
);
console.error(`Found ${billsRaw.length} bills with docs_id.`);

// Pre-load existing roll_calls to know what to skip (by pdf_doc_id).
const existingRollCalls = runD1(
    `SELECT pdf_doc_id FROM roll_calls WHERE session_name = '${SESSION}' AND pdf_doc_id IS NOT NULL`,
);
const alreadyParsed = new Set(existingRollCalls.map((r) => r.pdf_doc_id));
console.error(`${alreadyParsed.size} PDFs already parsed; will skip those.`);

// ── PDF fetch + cache ────────────────────────────────────────────────────────
async function cachedText(url, cachePath) {
    if (existsSync(cachePath)) return readFileSync(cachePath, 'utf8');
    const res = await fetch(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    const text = await res.text();
    writeFileSync(cachePath, text);
    await sleep(PAUSE_MS);
    return text;
}

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

// ── PDF text parsing ─────────────────────────────────────────────────────────
const SECTION_RE = /^(YEAS|NAYS|ABSENT|NOT\s+VOTING|NV)\.?$/i;
const SECTION_VOTE = { YEAS: 1, NAYS: 2, NV: 3, 'NOT VOTING': 3, ABSENT: 4 };

function extractDate(text) {
    const m = text.match(/Date:\s*(\d{1,2})\/(\d{1,2})\/(\d{4})/);
    if (!m) return null;
    const [, mm, dd, yyyy] = m;
    return `${yyyy}-${mm.padStart(2, '0')}-${dd.padStart(2, '0')}`;
}

const LEADERSHIP_PREFIXES = [
    'Madam President Pro Tem',
    'Mr. President Pro Tem',
    'Mr. President',
    'Mr. Speaker',
];

function splitMultiNameLine(line, chamber) {
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
            const re = new RegExp(
                `^${last.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:,\\s*[a-z]\\.?)?(?=\\s|$)`,
            );
            const m = normRemaining.match(re);
            if (m) {
                out.push(remaining.slice(0, m[0].length));
                remaining = remaining.slice(m[0].length).trim();
                matched = true;
                break;
            }
        }
        if (matched) continue;

        // Fallback: peel one token + optional ", X." disambiguator.
        const tokMatch = remaining.match(/^(\S+(?:,\s*[A-Za-z]\.?)?)/);
        if (!tokMatch) break;
        out.push(tokMatch[1]);
        remaining = remaining.slice(tokMatch[0].length).trim();
    }
    return out;
}

function firstNameHasInitial(firstName, initial) {
    if (!firstName) return false;
    const want = initial.toUpperCase();
    for (const tok of firstName.split(/\s+/)) {
        const clean = tok.replace(/^[^A-Za-z]+/, '');
        if (clean.toUpperCase().startsWith(want)) return true;
    }
    return false;
}

function lookupMember(name, chamber, rollCallDate) {
    const leader = LEADERSHIP[name];
    if (leader) {
        return byChamberLast[leader.chamber].get(norm(leader.last))?.[0] ?? null;
    }
    const disambig = name.match(/^(.+?),\s*([A-Za-z])\.?$/);
    const last = disambig ? disambig[1].trim() : name.trim();
    const initial = disambig?.[2] ?? null;
    const arr = byChamberLast[chamber].get(norm(last));
    if (!arr) return null;

    const eligible = rollCallDate
        ? arr.filter((l) => {
            const year = Number(rollCallDate.slice(0, 4));
            if (l.year_elected != null && l.year_elected > year) return false;
            if (l.term_start && l.term_start > rollCallDate) return false;
            if (l.term_end && l.term_end < rollCallDate) return false;
            return true;
        })
        : arr;
    if (eligible.length === 1) return eligible[0];
    if (eligible.length === 0) return null;
    if (initial) {
        const hit = eligible.find((l) => firstNameHasInitial(l.first_name, initial));
        if (hit) return hit;
    }
    return null;
}

// ── output SQL emission ──────────────────────────────────────────────────────
const syntheticInserts = [];        // new pdf-only legislators to create
const sessionMembershipInserts = []; // pdf-only legislator_sessions backfill
// chamber → normKey → canonical last_name (the form stored in DB). Seeded from
// the existing pdf-only legislators and extended whenever we queue a new one.
// Needed because PDFs cap-fold names inconsistently ("DeVillier" vs "DEVILLIER")
// and the SELECT lookup must use the exact stored form.
const pdfCanonical = { H: new Map(), S: new Map() };
for (const l of pdfOnlyRaw) pdfCanonical[l.chamber].set(norm(l.last_name), l.last_name);
// Track which pdf-only legislators we've already queued session membership for
// this run. Idempotent on disk via UNIQUE(legislator_id, session_name) on the
// junction, but skipping the duplicate work keeps the SQL output small.
const pdfMembershipQueued = new Set();
const rcChunks = [];           // roll_calls + votes inserts
const stats = { roll_calls: 0, votes: 0, unmatched: new Map(), synthetic_new: 0, skipped: 0 };

function queueSynthetic(chamber, displayName, normKey) {
    if (pdfCanonical[chamber].has(normKey)) return; // already known (stored or queued)
    const cleanLast = displayName.replace(/,\s*[A-Za-z]\.?\s*$/, '').trim();
    pdfCanonical[chamber].set(normKey, cleanLast);
    syntheticInserts.push(
        `INSERT INTO legislators (chamber, last_name, source) VALUES (${escSql(chamber)}, ${escSql(cleanLast)}, 'pdf') ON CONFLICT (chamber, last_name) WHERE source='pdf' DO NOTHING;`,
    );
    stats.synthetic_new++;
}

// Backfill legislator_sessions for pdf-only legislators that voted in this session.
// Roster members get their session membership from scrape-rosters; this only fires
// for unmatched names that got minted as pdf-only synthetics. active=0 marks them
// as not-currently-serving for the session (they wouldn't be a synthetic otherwise).
function queuePdfMembership(chamber, normKey) {
    const memKey = `${chamber}:${normKey}`;
    if (pdfMembershipQueued.has(memKey)) return;
    pdfMembershipQueued.add(memKey);
    const canonical = pdfCanonical[chamber].get(normKey);
    if (!canonical) return; // should not happen — queueSynthetic always sets it first
    const legislatorIdExpr = `(SELECT id FROM legislators WHERE chamber=${escSql(chamber)} AND last_name=${escSql(canonical)} AND source='pdf')`;
    const sessionIdExpr    = `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
    sessionMembershipInserts.push(
        `INSERT INTO legislator_sessions (legislator_id, session_id, session_name, role, active) VALUES (${legislatorIdExpr}, ${sessionIdExpr}, ${escSql(SESSION)}, ${escSql(chamber === 'S' ? 'Sen' : 'Rep')}, 0) ON CONFLICT(legislator_id, session_name) DO NOTHING;`,
    );
}

// Subquery that resolves a legislator surrogate id from the source-system natural key.
// roster: by (chamber, source_id). pdf-only: by (chamber, canonical last_name) where source='pdf'.
function legislatorIdExpr(member, chamber, displayName) {
    if (member) {
        return `(SELECT id FROM legislators WHERE chamber=${escSql(chamber)} AND source_id=${member.source_id})`;
    }
    const cleanLast = displayName.replace(/,\s*[A-Za-z]\.?\s*$/, '').trim();
    // Resolve to the canonical stored form so casing/diacritic variants in the
    // PDF all map to the one DB row queued for that (chamber, normKey).
    const canonical = pdfCanonical[chamber].get(norm(cleanLast)) ?? cleanLast;
    return `(SELECT id FROM legislators WHERE chamber=${escSql(chamber)} AND last_name=${escSql(canonical)} AND source='pdf')`;
}

function rollCallIdExpr(chamber, rcNumber) {
    return `(SELECT id FROM roll_calls WHERE chamber=${escSql(chamber)} AND session_name=${escSql(SESSION)} AND rc_number=${rcNumber})`;
}

function billIdExpr(billNumber) {
    return `(SELECT id FROM bills WHERE session_name=${escSql(SESSION)} AND bill_number=${escSql(billNumber)})`;
}

function sessionIdExpr() {
    return `(SELECT id FROM sessions WHERE name=${escSql(SESSION)})`;
}

// ── main loop ────────────────────────────────────────────────────────────────
let pdfsProcessed = 0;
const limit = flags.limit ?? Infinity;

for (const bill of billsRaw) {
    if (pdfsProcessed >= limit) break;

    const votesHtml = await cachedText(
        `https://legis.la.gov/legis/BillDocs.aspx?i=${bill.docs_id}&t=votes`,
        join(VOTES_CACHE, `${bill.bill_number}.html`),
    );
    const pdfRows = parseVotePage(votesHtml);
    if (pdfRows.length === 0) continue;

    for (const pdfRow of pdfRows) {
        if (pdfsProcessed >= limit) break;
        if (flags.doc && pdfRow.doc_id !== flags.doc) continue;
        if (alreadyParsed.has(pdfRow.doc_id)) {
            stats.skipped++;
            continue;
        }

        let buf;
        try { buf = await fetchPdf(pdfRow.doc_id); }
        catch (e) { console.error(`fetch ${pdfRow.doc_id} failed: ${e.message}`); continue; }

        let text;
        try { text = await parsePdf(buf); }
        catch (e) { console.error(`parse ${pdfRow.doc_id} failed: ${e.message}`); continue; }

        const lines = text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
        const tallies = { 1: 0, 2: 0, 3: 0, 4: 0 };
        const voters = []; // { chamber, displayName, member, vote }
        let currentVote = null;
        const dateStr = extractDate(text);

        for (const line of lines) {
            const sec = line.match(SECTION_RE);
            if (sec) {
                const key = sec[1].toUpperCase().replace(/\s+/g, ' ');
                currentVote = SECTION_VOTE[key] ?? null;
                continue;
            }
            if (/^Total\s*--\s*\d+/i.test(line)) { currentVote = null; continue; }
            if (currentVote === null) continue;
            if (/^--\s*\d+\s*of\s*\d+\s*--$/.test(line)) continue;

            const names = splitMultiNameLine(line, pdfRow.chamber);
            for (const name of names) {
                const member = lookupMember(name, pdfRow.chamber, dateStr);
                if (!member) {
                    stats.unmatched.set(name, (stats.unmatched.get(name) || 0) + 1);
                    const cleanLast = name.replace(/,\s*[A-Za-z]\.?\s*$/, '').trim();
                    const normKey  = norm(cleanLast);
                    queueSynthetic(pdfRow.chamber, name, normKey);
                    queuePdfMembership(pdfRow.chamber, normKey);
                }
                voters.push({
                    chamber: pdfRow.chamber,
                    displayName: name,
                    member,
                    vote: currentVote,
                });
                tallies[currentVote]++;
            }
        }

        const date = dateStr ?? '1970-01-01';
        const yea = tallies[1], nay = tallies[2], nv = tallies[3], absent = tallies[4];
        const total = yea + nay + nv + absent;
        const passed = yea > nay ? 1 : 0;
        const margin = Math.abs(yea - nay);

        // Insert the complete roll_call row in one shot. No more shell.
        // ON CONFLICT DO NOTHING because we pre-filtered already-parsed PDFs;
        // race-condition guard only.
        rcChunks.push(
            `INSERT INTO roll_calls (bill_id, session_id, session_name, chamber, rc_number, date, description, vote_category, yea, nay, nv, absent, total, passed, margin, pdf_doc_id) VALUES (${billIdExpr(bill.bill_number)}, ${sessionIdExpr()}, ${escSql(SESSION)}, ${escSql(pdfRow.chamber)}, ${pdfRow.rc_number}, ${escSql(date)}, ${escSql(pdfRow.description)}, ${escSql(pdfRow.category)}, ${yea}, ${nay}, ${nv}, ${absent}, ${total}, ${passed}, ${margin}, ${pdfRow.doc_id}) ON CONFLICT(chamber, session_name, rc_number) DO NOTHING;`,
        );

        for (const v of voters) {
            rcChunks.push(
                `INSERT INTO votes (roll_call_id, legislator_id, vote, source) VALUES (${rollCallIdExpr(v.chamber, pdfRow.rc_number)}, ${legislatorIdExpr(v.member, v.chamber, v.displayName)}, ${v.vote}, 'pdf') ON CONFLICT(roll_call_id, legislator_id) DO UPDATE SET vote=excluded.vote;`,
            );
        }

        stats.roll_calls++;
        stats.votes += voters.length;
        pdfsProcessed++;
    }
}

// ── write output ─────────────────────────────────────────────────────────────
const out = [
    `-- parse-rollcalls output for session ${SESSION}`,
    `-- ${new Date().toISOString()}`,
    `BEGIN TRANSACTION;`,
    // pdf-only legislator rows must be inserted before any session memberships
    // or votes that reference them via the (chamber, last_name) subquery.
    ...syntheticInserts,
    ...sessionMembershipInserts,
    ...rcChunks,
    `COMMIT;`,
].join('\n');
writeFileSync(OUT_PATH, out);

console.error(`Wrote ${OUT_PATH}`);
console.error(`Roll calls parsed: ${stats.roll_calls}`);
console.error(`Votes recorded:   ${stats.votes}`);
console.error(`Skipped (already): ${stats.skipped}`);
console.error(`New synthetic legislators: ${stats.synthetic_new}`);

const top = [...stats.unmatched.entries()].sort((a, b) => b[1] - a[1]).slice(0, 20);
if (top.length > 0) {
    console.error('Top unmatched names:');
    for (const [name, n] of top) console.error(`  ${n}\t${name}`);
}
