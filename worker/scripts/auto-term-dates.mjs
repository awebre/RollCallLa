#!/usr/bin/env node
// For each current legislator who shares a last name with another current member,
// find the first roll-call PDF that uses their initialed disambiguator (e.g.
// "Henry, D.") and use that date as their term_start.
//
// This pins down mid-session joiners (Dana Henry, sworn in around 2026-03-24)
// so the term filter in parse-rollcalls.mjs can keep bare-"Henry" PDFs from
// before that date attributing to the wrong person.
//
// Usage:
//   node --experimental-strip-types scripts/auto-term-dates.mjs
//   wrangler d1 execute la_vote_tracker --local --file /tmp/term_starts.sql

import { PDFParse } from 'pdf-parse';
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');

function runD1(cmd) {
    const out = execFileSync('npx', ['wrangler', 'd1', 'execute', 'la_vote_tracker', '--local', '--command', cmd, '--json'], {
        cwd: ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    const jsonStart = out.indexOf('\n[');
    const json = JSON.parse(out.slice(jsonStart === -1 ? out.indexOf('[') : jsonStart + 1));
    return json[0]?.results ?? [];
}

function escSql(v) { return `'${String(v).replace(/'/g, "''")}'`; }
function firstInitial(firstName) {
    for (const tok of firstName.split(/\s+/)) {
        const clean = tok.replace(/^[^A-Za-z]+/, '');
        if (clean) return clean[0].toUpperCase();
    }
    return null;
}

console.error('Loading legislators with shared last names...');
const dups = runD1(
    `SELECT l.people_id, l.first_name, l.last_name, l.role
     FROM legislators l
     WHERE l.active = 1
       AND l.last_name IN (
         SELECT last_name FROM legislators WHERE active = 1 GROUP BY last_name, role HAVING COUNT(*) > 1
       )`,
);
console.error(`${dups.length} members in disambig'd groups.`);

console.error('Loading roll calls (ordered by date)...');
const rollCalls = runD1(
    `SELECT rc.pdf_doc_id, rc.chamber, rc.date FROM roll_calls rc WHERE rc.pdf_doc_id IS NOT NULL ORDER BY rc.date`,
);

// Index PDF text once so we can scan each member's disambig pattern.
const pdfCache = join(ROOT, '.scrape-cache', '24RS', 'pdfs');
async function loadPdfText(docId) {
    const path = join(pdfCache, `${docId}.pdf`);
    if (!existsSync(path)) return null;
    const buf = readFileSync(path);
    return (await new PDFParse({ data: new Uint8Array(buf) }).getText()).text;
}

const sql = ['-- Auto-derived term_start from first disambig appearance', `-- ${new Date().toISOString()}`];
let resolved = 0;

for (const m of dups) {
    const initial = firstInitial(m.first_name);
    if (!initial) continue;
    const last = m.last_name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const targetChamber = m.role === 'Sen' ? 'S' : 'H';
    const re = new RegExp(`\\b${last},\\s*${initial}\\b`);
    let firstDate = null;
    for (const rc of rollCalls) {
        if (rc.chamber !== targetChamber) continue;
        const text = await loadPdfText(rc.pdf_doc_id);
        if (!text) continue;
        if (re.test(text)) { firstDate = rc.date; break; }
    }
    if (firstDate) {
        resolved++;
        sql.push(`UPDATE legislators SET term_start=${escSql(firstDate)} WHERE people_id=${m.people_id};`);
        console.error(`  ${m.last_name}, ${initial}. (${m.first_name}) -> ${firstDate}`);
    }
}

const out = '/tmp/term_starts.sql';
writeFileSync(out, sql.join('\n'));
console.error(`Wrote ${out}: ${resolved} term_start rows.`);
