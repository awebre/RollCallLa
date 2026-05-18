// Classify a roll-call description string into a small indexed enum.
// Default UI filter is `final_passage` only — this is what makes the
// tracker usable instead of a data dump of procedural noise.
//
// Order matters: check `override` and `concurrence` before `final_passage`
// because they often contain the word "passage" or "adopt" too.

export type VoteCategory =
    | 'final_passage'
    | 'concurrence'
    | 'override'
    | 'amendment'
    | 'procedural'
    | 'other';

const RULES: { kind: VoteCategory; re: RegExp }[] = [
    { kind: 'override',    re: /\b(override|veto\s*override)\b/i },
    { kind: 'concurrence', re: /\bconcur(?:rence|ring|red|s)?\b/i },
    // Amendment must precede final_passage so phrases like "ADOPT AMENDMENT" classify as amendment
    // rather than getting eaten by the "adopt" rule below.
    { kind: 'amendment',   re: /\bamendments?\b/i },
    // "ADOPT" / "ADOPTED" / "ADOPT CONFERENCE REPORT" are functionally final-passage events for
    // resolutions and conferenced bills.
    { kind: 'final_passage', re: /\b(final\s+passage|final\s+adoption|engrossment|passage|adopt(?:ed|ion)?|conference\s+report)\b/i },
    {
        kind: 'procedural',
        re: /\b(motion|move\s+to|suspend(?:\s+the)?\s+rules?|recess|adjourn(?:ment)?|reconsider(?:ation)?|lay\s+(?:on\s+the\s+)?table|return\s+to\s+the\s+calendar|previous\s+question|division\s+of\s+the\s+question|withdraw|co-?authors?|time\s+limits?|call\s+from\s+(?:the\s+)?calendar|2\/3\s+vote)\b/i,
    },
];

export function categorize(description: string | null | undefined): VoteCategory {
    if (!description) return 'other';
    for (const { kind, re } of RULES) {
        if (re.test(description)) return kind;
    }
    return 'other';
}
