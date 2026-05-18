import { useEffect, useState } from 'react';
import type { RollCallMember } from '../types';
import { formatName, partyColor, VOTE_LABEL } from '../types';

type RollCallHead = {
    roll_call_id: number;
    bill_id: number;
    bill_number: string;
    title: string | null;
    date: string;
    chamber: string;
    description: string;
    vote_category: string;
    yea: number; nay: number; nv: number; absent: number; total: number;
    passed: number;
    margin: number;
};

export function RollCallDetail({ id }: { id: number }) {
    const [head, setHead] = useState<RollCallHead | null>(null);
    const [members, setMembers] = useState<RollCallMember[]>([]);

    useEffect(() => {
        fetch(`/api/rollcalls/${id}`)
            .then((r) => r.json() as Promise<{ roll_call: RollCallHead; members: RollCallMember[] }>)
            .then((d) => { setHead(d.roll_call); setMembers(d.members); });
    }, [id]);

    if (!head) return <p style={{ color: '#666' }}>Loading roll call…</p>;
    const byVote: Record<number, RollCallMember[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const m of members) byVote[m.vote].push(m);

    return (
        <>
            <p style={{ marginTop: 0 }}>
                <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); history.back(); }}
                    style={{ color: '#666' }}
                >
                    ← back
                </a>
            </p>
            <h2 style={{ marginBottom: 0, fontSize: '1.4rem' }}>
                {head.bill_number}: {head.description}
            </h2>
            <p style={{ color: '#444', marginTop: '0.2rem' }}>
                {head.chamber === 'H' ? 'House' : 'Senate'} · {head.date} · category {head.vote_category}
            </p>
            {head.title && (
                <p style={{ color: '#444', fontStyle: 'italic', borderLeft: '3px solid #ddd', padding: '0.25rem 0 0.25rem 0.75rem' }}>
                    {head.title}
                </p>
            )}
            <p style={{ color: head.passed ? '#1d6b3a' : '#a32a2a', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                {head.passed ? 'PASSED' : 'FAILED'}
                {'  '}Yea {head.yea} · Nay {head.nay} · NV {head.nv} · Absent {head.absent} · margin {head.margin}
            </p>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
                {[1, 2, 3, 4].map((v) => (
                    <div key={v}>
                        <h3 style={{ margin: 0, borderBottom: '2px solid #1a1a1a', paddingBottom: '0.3rem', fontSize: '0.9rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            {VOTE_LABEL[v]} · {byVote[v].length}
                        </h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                            {byVote[v].map((m) => (
                                <li key={m.people_id} style={{ padding: '0.15rem 0', borderBottom: '1px solid #f0f0f0' }}>
                                    <a href={`#/legislator/${m.people_id}`} style={{ color: '#1a1a1a' }}>
                                        {formatName(m)}
                                    </a>
                                    <span style={{ color: partyColor(m.party), marginLeft: '0.4rem', fontWeight: 600 }}>{m.party ?? ''}</span>
                                    {m.district && <span style={{ color: '#888' }}> · D{m.district}</span>}
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </section>
        </>
    );
}
