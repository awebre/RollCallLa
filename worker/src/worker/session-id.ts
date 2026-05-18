// Parse legis.la.gov session-id strings into our internal numeric session_id.
//
// legis.la.gov uses these forms:
//   24RS      Regular Session
//   24OS      Organizational Session
//   241ES     First Extraordinary Session of 2024
//   243ES     Third Extraordinary Session of 2024
//   221VS     First Veto Session of 2022 (rare)
//   21VS      Veto Session of 2021 (no number)
//
// Encoding (preserved across versions for stability):
//   YY * 1000 + kindCode
//
//   kindCode = 1            for RS
//              2            for OS
//              10 + n       for ES (so 1st = 11, 2nd = 12, ...)
//              20 + n       for VS (so 1st = 21, 2nd = 22, ...)
//
// This keeps 24RS = 24001 / 26RS = 26001 stable (matches what's already in
// the DB) and gives each ES/VS variant a distinct id within its year.

export type SessionKind = 'RS' | 'OS' | 'ES' | 'VS';

export type ParsedSession = {
    raw: string;       // original input, e.g. '241ES'
    year: number;      // 4-digit year, e.g. 2024
    kind: SessionKind;
    n: number;         // 0 for RS/OS, 1+ for nth ES/VS
};

export function parseSession(s: string): ParsedSession {
    const m = s.match(/^(\d{2})(\d*)(RS|OS|ES|VS)$/);
    if (!m) throw new Error(`Unrecognized session id: ${s}`);
    const kind = m[3] as SessionKind;
    const n = m[2] ? Number(m[2]) : 0;
    if ((kind === 'RS' || kind === 'OS') && n !== 0) {
        throw new Error(`Session ${s}: RS / OS don't take an ordinal number`);
    }
    return { raw: s, year: 2000 + Number(m[1]), kind, n };
}

export function sessionIdFor(s: string): number {
    const p = parseSession(s);
    const yy = p.year - 2000;
    let kindCode: number;
    if (p.kind === 'RS') kindCode = 1;
    else if (p.kind === 'OS') kindCode = 2;
    else if (p.kind === 'ES') kindCode = 10 + p.n;
    else /* VS */            kindCode = 20 + p.n;
    return yy * 1000 + kindCode;
}

export function isSpecialSession(s: string): boolean {
    const p = parseSession(s);
    return p.kind !== 'RS';
}
