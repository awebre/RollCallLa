export type Legislator = {
    id: number;
    chamber: 'H' | 'S';
    source_id: number | null;            // null for pdf-only legislators
    first_name: string | null;
    last_name: string;
    suffix: string | null;
    nickname: string | null;
    source?: 'roster' | 'pdf' | null;
    // Per-session fields — joined from legislator_sessions for the scoped session.
    // Null when no membership row exists for the scoped session (pdf-only across-the-board).
    role?: string | null;                // 'Sen' | 'Rep'
    party?: 'R' | 'D' | 'I' | null;
    district?: number | null;
    active?: number | null;
    term_start?: string | null;
    term_end?: string | null;
    year_elected?: number | null;
};

export type LegislatorVoteRow = {
    roll_call_id: number;
    date: string;
    chamber: string;
    description: string;
    vote_category: string;
    yea: number; nay: number; nv: number; absent: number; total: number;
    passed: number;
    margin: number;
    bill_id: number;
    bill_number: string;
    title: string | null;
    cast_vote: 1 | 2 | 3 | 4;
    pdf_doc_id: number | null;
};

export type RollCallMember = {
    vote: 1 | 2 | 3 | 4;
    legislator_id: number;
    chamber: 'H' | 'S';
    source_id: number | null;
    first_name: string | null;
    last_name: string;
    suffix: string | null;
    nickname: string | null;
    source?: 'roster' | 'pdf' | null;
    // Per-session at the time of the roll call (from legislator_sessions).
    role?: string | null;
    party?: 'R' | 'D' | 'I' | null;
    district?: number | null;
};

export type Session = {
    id: number;
    name: string;
    year: number;
    type: 'regular' | 'special';
    start_date: string | null;
    end_date: string | null;
    map_vintage: string;
};

export function formatName(l: { first_name: string | null; last_name: string; suffix: string | null; nickname?: string | null }) {
    const nick = l.nickname ? ` "${l.nickname}"` : '';
    const suffix = l.suffix ? `, ${l.suffix}` : '';
    const first = l.first_name ?? '';
    return first ? `${l.last_name}${suffix}, ${first}${nick}` : `${l.last_name}${suffix}`;
}

export function partyColor(p: string | null | undefined) {
    if (p === 'D') return 'var(--party-d)';
    if (p === 'R') return 'var(--party-r)';
    if (p === 'I') return 'var(--party-i)';
    return 'var(--party-none)';
}

export const VOTE_LABEL: Record<number, string> = { 1: 'Yea', 2: 'Nay', 3: 'NV', 4: 'Absent' };
export function voteColor(v: number) {
    if (v === 1) return 'var(--vote-yea)';
    if (v === 2) return 'var(--vote-nay)';
    if (v === 3) return 'var(--vote-nv)';
    return 'var(--vote-absent)';
}

// "24RS" -> "2024 Regular Session"
// "24ES" -> "2024 Extraordinary Session"
// "24ES2" -> "2024 2nd Extraordinary Session"
// Anything else -> fall back to raw `name`.
export function formatSessionName(name: string, year: number): string {
    const tail = name.replace(/^\d+/, '');
    if (tail === 'RS') return `${year} Regular Session`;
    const esMatch = tail.match(/^ES(\d*)$/);
    if (esMatch) {
        const n = esMatch[1] ? Number(esMatch[1]) : 1;
        const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`;
        return `${year} ${ord} Extraordinary Session`;
    }
    return name;
}
