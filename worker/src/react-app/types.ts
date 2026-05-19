export type Legislator = {
    people_id: number;
    first_name: string;
    middle_name: string | null;
    last_name: string;
    suffix: string | null;
    nickname: string | null;
    party: string | null;
    role: string | null;
    district: string | null;
    active: number;
    source?: 'roster' | 'pdf' | null;
    term_source?: 'official' | 'wikipedia' | 'derived' | null;
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
    people_id: number;
    first_name: string;
    last_name: string;
    suffix: string | null;
    nickname: string | null;
    party: string | null;
    role: string | null;
    district: string | null;
    source?: 'roster' | 'pdf' | null;
};

export function formatName(l: { first_name: string; last_name: string; suffix: string | null; nickname?: string | null }) {
    const nick = l.nickname ? ` "${l.nickname}"` : '';
    const suffix = l.suffix ? `, ${l.suffix}` : '';
    return `${l.last_name}${suffix}, ${l.first_name}${nick}`;
}

export function partyColor(p: string | null) {
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
export function formatSessionName(name: string, year_start: number): string {
    const tail = name.replace(/^\d+/, '');
    if (tail === 'RS') return `${year_start} Regular Session`;
    const esMatch = tail.match(/^ES(\d*)$/);
    if (esMatch) {
        const n = esMatch[1] ? Number(esMatch[1]) : 1;
        const ord = ['1st', '2nd', '3rd', '4th', '5th', '6th'][n - 1] ?? `${n}th`;
        return `${year_start} ${ord} Extraordinary Session`;
    }
    return name;
}
