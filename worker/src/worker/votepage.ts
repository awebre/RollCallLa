// Parses a legis.la.gov BillDocs.aspx?t=votes HTML response into roll-call rows.
//
// Each row is a link like:
//   <a href="ViewDocument.aspx?d=1381402" target="_blank">House Vote on HB 1, CONCUR IN SENATE AMENDMENTS (#1730)</a>
// Captured fields:
//   doc_id        - integer ID of the PDF (used as pdf_doc_id on roll_calls)
//   chamber       - 'H' or 'S'
//   bill_number   - 'HB 1' style; we keep the original string with the space
//   description   - 'CONCUR IN SENATE AMENDMENTS' style; fed to the vote_category
//                   classifier (categorize.ts) to pick the indexed enum
//   rc_number     - chamber-scoped roll-call sequence number

import { categorize, type VoteCategory } from './categorize.ts';

export type VotePageRow = {
    doc_id: number;
    chamber: 'H' | 'S';
    bill_number: string;
    description: string;
    rc_number: number;
    category: VoteCategory;
};

export const VOTE_ROW_RE =
    /<a\s+href="ViewDocument\.aspx\?d=(\d+)"[^>]*>(House|Senate)\s+Vote\s+on\s+([A-Z]+\s*\d+),\s*([^<(]+?)\s*\(#(\d+)\)\s*<\/a>/g;

function decodeEntities(s: string): string {
    return s
        .replace(/&amp;/g, '&')
        .replace(/&quot;/g, '"')
        .replace(/&#39;/g, "'")
        .replace(/&lt;/g, '<')
        .replace(/&gt;/g, '>')
        .replace(/&nbsp;/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

export function parseVotePage(html: string): VotePageRow[] {
    const rows: VotePageRow[] = [];
    for (const m of html.matchAll(VOTE_ROW_RE)) {
        const [, docId, chamberWord, billNumber, descriptionRaw, rcNum] = m;
        const description = decodeEntities(descriptionRaw);
        rows.push({
            doc_id: Number(docId),
            chamber: chamberWord === 'House' ? 'H' : 'S',
            bill_number: billNumber,
            description,
            rc_number: Number(rcNum),
            category: categorize(description),
        });
    }
    return rows;
}
