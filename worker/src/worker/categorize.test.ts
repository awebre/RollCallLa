import { describe, it, expect } from 'vitest';
import { categorize } from './categorize';

describe('categorize', () => {
    it.each([
        ['House Vote on HB 1, FINAL PASSAGE (#720)', 'final_passage'],
        ['Senate Vote on HB 1, FINAL PASSAGE (#1431)', 'final_passage'],
        ['House Vote on HB 1, CONCUR IN SENATE AMENDMENTS (#1730)', 'concurrence'],
        ['Senate Vote on SCR 5, ADOPTED (#42)', 'final_passage'],
        ['House Vote on HB 100, ADOPT CONFERENCE REPORT (#1500)', 'final_passage'],
        ['ADOPT', 'final_passage'],
        ['ADD CO-AUTHORS', 'procedural'],
        ['MODIFY TIME LIMITS', 'procedural'],
        ['CALL FROM CALENDAR', 'procedural'],
        ['2/3 vote', 'procedural'],
        ['Floor Amendment 234', 'amendment'],
        ['Floor Amendments 1, 2, and 3', 'amendment'],
        ['MOTION TO SUSPEND RULES (#88)', 'procedural'],
        ['Motion to Recess', 'procedural'],
        ['Override of Governor\'s Veto', 'override'],
        ['Veto Override', 'override'],
        ['Engrossment', 'final_passage'],
        ['', 'other'],
        ['some random non-matching string', 'other'],
    ])('categorizes %j as %s', (desc, expected) => {
        expect(categorize(desc)).toBe(expected);
    });

    it('checks override before passage', () => {
        // "override" should win even if "passage" appears in the same string
        expect(categorize('Override of veto on FINAL PASSAGE bill')).toBe('override');
    });

    it('checks concurrence before amendment', () => {
        // "CONCUR IN SENATE AMENDMENTS" contains "amendments" — concurrence must win
        expect(categorize('CONCUR IN SENATE AMENDMENTS')).toBe('concurrence');
    });

    it('handles null/undefined gracefully', () => {
        expect(categorize(null)).toBe('other');
        expect(categorize(undefined)).toBe('other');
    });
});
