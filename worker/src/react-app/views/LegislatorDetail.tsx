import { useEffect, useState } from 'react';
import type { Legislator, LegislatorVoteRow } from '../types';
import { formatName, partyColor, voteColor, VOTE_LABEL } from '../types';
import { useSession } from '../SessionContext';

type Profile = {
    legislator: Legislator;
    final_passage_tally: { yea: number; nay: number; nv: number; absent: number };
    party_line: number | null;
};

export function LegislatorDetail({ id }: { id: number }) {
    const { current } = useSession();
    const sessionId = current?.session_id ?? null;
    const [profile, setProfile] = useState<Profile | null>(null);
    const [votes, setVotes] = useState<LegislatorVoteRow[]>([]);
    const [loading, setLoading] = useState(true);
    const [category, setCategory] = useState<string>('final_passage');
    const [vote, setVote] = useState<string>('');
    const [closeOnly, setCloseOnly] = useState(false);
    const [q, setQ] = useState('');

    useEffect(() => {
        const params = new URLSearchParams();
        if (sessionId) params.set('session_id', String(sessionId));
        fetch(`/api/legislators/${id}?${params.toString()}`)
            .then((r) => r.json() as Promise<Profile>)
            .then(setProfile);
    }, [id, sessionId]);

    useEffect(() => {
        if (sessionId === null) return;
        const params = new URLSearchParams();
        params.set('session_id', String(sessionId));
        if (category) params.set('category', category);
        if (vote) params.set('vote', vote);
        if (closeOnly) params.set('close', '1');
        if (q) params.set('q', q);
        params.set('limit', '100');
        setLoading(true);
        fetch(`/api/legislators/${id}/votes?${params.toString()}`)
            .then((r) => r.json() as Promise<{ votes: LegislatorVoteRow[] }>)
            .then((d) => setVotes(d.votes))
            .finally(() => setLoading(false));
    }, [id, sessionId, category, vote, closeOnly, q]);

    if (!profile) return <p style={{ color: '#666' }}>Loading legislator…</p>;
    const { legislator: l, final_passage_tally: t, party_line } = profile;
    const fp_total = t.yea + t.nay + t.nv + t.absent;

    return (
        <>
            <p style={{ marginTop: 0 }}>
                <a href="#/" style={{ color: '#666' }}>← all legislators</a>
            </p>
            <h2 style={{ marginBottom: 0, fontSize: '1.6rem' }}>{formatName(l)}</h2>
            <p style={{ color: '#444', marginTop: '0.2rem' }}>
                <span style={{ color: partyColor(l.party), fontWeight: 600 }}>{partyName(l.party)}</span>
                {' · '}{l.role === 'Sen' ? 'Senator' : 'Representative'}
                {l.district ? ` · District ${l.district}` : ''}
                {l.active === 0 ? ' · not currently serving' : ''}
            </p>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))', gap: '0.5rem', margin: '1.25rem 0' }}>
                <Stat label="Yea (FP)"    value={t.yea} />
                <Stat label="Nay (FP)"    value={t.nay} />
                <Stat label="No vote"     value={t.nv} />
                <Stat label="Absent"      value={t.absent} />
                <Stat label="Total FP"    value={fp_total} />
                <Stat label="Party-line" value={party_line == null ? '—' : `${party_line}%`} />
            </section>

            <div style={{ display: 'flex', gap: '0.75rem', flexWrap: 'wrap', alignItems: 'center', marginTop: '1rem' }}>
                <select value={category} onChange={(e) => setCategory(e.target.value)} style={{ padding: '0.5rem' }}>
                    <option value="final_passage">Final passage only</option>
                    <option value="concurrence">Concurrence</option>
                    <option value="override">Veto override</option>
                    <option value="amendment">Amendments</option>
                    <option value="procedural">Procedural</option>
                    <option value="">All categories</option>
                </select>
                <select value={vote} onChange={(e) => setVote(e.target.value)} style={{ padding: '0.5rem' }}>
                    <option value="">Any vote cast</option>
                    <option value="1">Only Yea</option>
                    <option value="2">Only Nay</option>
                    <option value="3">Only NV</option>
                    <option value="4">Only Absent</option>
                </select>
                <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.4rem' }}>
                    <input type="checkbox" checked={closeOnly} onChange={(e) => setCloseOnly(e.target.checked)} />
                    Close votes only (margin ≤ 10)
                </label>
                <input
                    type="search"
                    placeholder="Bill # or title…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    style={{ flex: '1 1 200px', padding: '0.5rem', border: '1px solid #bbb' }}
                />
            </div>

            <p style={{ color: '#666', marginTop: '1rem', fontSize: '0.9rem' }}>
                {loading ? 'Loading…' : `${votes.length} vote${votes.length === 1 ? '' : 's'}`}
                {votes.length === 100 ? ' (showing 100 most recent — refine filters to see more)' : ''}
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid #1a1a1a', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Date</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Bill</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Description</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Cast</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Tally</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Result</th>
                    </tr>
                </thead>
                <tbody>
                    {votes.map((v) => (
                        <tr key={v.roll_call_id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '0.4rem 0.25rem', whiteSpace: 'nowrap' }}>{v.date}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{v.bill_number}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>
                                <a href={`#/rollcall/${v.roll_call_id}`} style={{ color: '#1a1a1a' }}>
                                    {v.description}
                                </a>
                                {v.title ? (
                                    <span style={{ color: '#777', display: 'block', fontSize: '0.8rem', maxWidth: 480, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                        {v.title}
                                    </span>
                                ) : null}
                            </td>
                            <td style={{ padding: '0.4rem 0.25rem', color: voteColor(v.cast_vote), fontWeight: 700 }}>{VOTE_LABEL[v.cast_vote]}</td>
                            <td style={{ padding: '0.4rem 0.25rem', whiteSpace: 'nowrap', color: '#444' }}>
                                {v.yea}–{v.nay}
                            </td>
                            <td style={{ padding: '0.4rem 0.25rem', color: v.passed ? '#1d6b3a' : '#a32a2a' }}>{v.passed ? 'Passed' : 'Failed'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}

function partyName(p: string | null) {
    if (p === 'D') return 'Democrat';
    if (p === 'R') return 'Republican';
    if (p === 'I') return 'Independent';
    return 'Unaffiliated';
}

function Stat({ label, value }: { label: string; value: number | string }) {
    return (
        <div style={{ border: '1px solid #ddd', padding: '0.6rem 0.75rem', background: '#fafaf6' }}>
            <div style={{ fontSize: '0.7rem', color: '#666', letterSpacing: '0.04em', textTransform: 'uppercase' }}>{label}</div>
            <div style={{ fontSize: '1.4rem', fontFamily: 'ui-monospace, monospace' }}>{value}</div>
        </div>
    );
}
