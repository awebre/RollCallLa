import { describe, it, expect } from 'vitest';
import { parseVotePage } from './votepage';

// Representative slice of legis.la.gov's BillDocs.aspx?t=votes output.
// Real responses are wrapped in an ASP.NET form + table but only the <a>
// anchors matter for our parser. Keeping the fixture inline so a layout
// drift on legis.la.gov stays loudly visible in the diff.
const SAMPLE = `
<table border="0" cellpadding="4" cellspacing="0">
  <tr valign="top">
    <td><a href="ViewDocument.aspx?d=1381402"  target="_blank">House Vote on HB 1, CONCUR IN SENATE AMENDMENTS (#1730)</a></td>
  </tr>
  <tr valign="top">
    <td><a href="ViewDocument.aspx?d=1381218"  target="_blank">Senate Vote on HB 1, FINAL PASSAGE (#1431)</a></td>
  </tr>
  <tr valign="top">
    <td><a href="ViewDocument.aspx?d=1369388"  target="_blank">House Vote on HB 1, FINAL PASSAGE (#720)</a></td>
  </tr>
</table>
`;

describe('parseVotePage', () => {
    it('extracts every vote-link row from a multi-row votes page', () => {
        const rows = parseVotePage(SAMPLE);
        expect(rows).toHaveLength(3);
    });

    it('captures chamber, bill number, RC number, and category for each row', () => {
        const rows = parseVotePage(SAMPLE);
        expect(rows[0]).toMatchObject({
            doc_id: 1381402,
            chamber: 'H',
            bill_number: 'HB 1',
            description: 'CONCUR IN SENATE AMENDMENTS',
            rc_number: 1730,
            category: 'concurrence',
        });
        expect(rows[1]).toMatchObject({
            doc_id: 1381218,
            chamber: 'S',
            rc_number: 1431,
            category: 'final_passage',
        });
        expect(rows[2]).toMatchObject({ doc_id: 1369388, chamber: 'H', category: 'final_passage' });
    });

    it('returns an empty array for a votes page with no rows', () => {
        expect(parseVotePage('<table></table>')).toEqual([]);
    });

    it('decodes HTML entities in the description', () => {
        const html = `<a href="ViewDocument.aspx?d=42" target="_blank">House Vote on HR 5, AMEND&nbsp;&amp;&nbsp;READOPT (#99)</a>`;
        const rows = parseVotePage(html);
        expect(rows[0].description).toBe('AMEND & READOPT');
    });

    it('handles bill numbers with embedded spaces (HB 100, SCR 5)', () => {
        const html = `<a href="ViewDocument.aspx?d=1" target="_blank">Senate Vote on SCR 5, ADOPT (#42)</a>`;
        const [row] = parseVotePage(html);
        expect(row.bill_number).toBe('SCR 5');
        expect(row.category).toBe('final_passage'); // ADOPT
    });
});
