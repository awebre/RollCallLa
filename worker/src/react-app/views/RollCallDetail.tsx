import { useEffect, useState } from 'react';
import type { RollCallMember } from '../types';
import { formatName, partyColor, VOTE_LABEL } from '../types';
import { ProvenanceBadge } from '../components/ProvenanceBadge';

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
    pdf_doc_id: number | null;
    session_name: string;
};

export function RollCallDetail({ id }: { id: number }) {
    const [head, setHead] = useState<RollCallHead | null>(null);
    const [members, setMembers] = useState<RollCallMember[]>([]);

    useEffect(() => {
        fetch(`/api/rollcalls/${id}`)
            .then((r) => r.json() as Promise<{ roll_call: RollCallHead; members: RollCallMember[] }>)
            .then((d) => { setHead(d.roll_call); setMembers(d.members); });
    }, [id]);

    if (!head) return <p style={{ color: 'var(--app-text-muted)' }}>Loading roll call…</p>;
    const byVote: Record<number, RollCallMember[]> = { 1: [], 2: [], 3: [], 4: [] };
    for (const m of members) byVote[m.vote].push(m);

    return (
        <>
            <p style={{ marginTop: 0 }}>
                <a
                    href="#"
                    onClick={(e) => { e.preventDefault(); history.back(); }}
                    style={{ color: 'var(--app-text-muted)' }}
                >
                    ← back
                </a>
            </p>
            <h2 style={{ marginBottom: 0, fontSize: '1.4rem' }}>
                {head.bill_number}: {head.description}
            </h2>
            <p style={{ color: 'var(--app-text-mid)', marginTop: '0.2rem' }}>
                {head.chamber === 'H' ? 'House' : 'Senate'} · {head.date} · category {head.vote_category}
            </p>
            {head.title && (
                <p style={{ color: 'var(--app-text-mid)', fontStyle: 'italic', borderLeft: '3px solid var(--app-border-light)', padding: '0.25rem 0 0.25rem 0.75rem' }}>
                    {head.title}
                </p>
            )}
            <p style={{ color: head.passed ? 'var(--app-pass)' : 'var(--app-fail)', fontWeight: 700, fontFamily: 'ui-monospace, monospace' }}>
                {head.passed ? 'PASSED' : 'FAILED'}
                {'  '}Yea {head.yea} · Nay {head.nay} · NV {head.nv} · Absent {head.absent} · margin {head.margin}
            </p>
            <p style={{ fontSize: '0.85rem' }}>
                <a
                    href={`https://legis.la.gov/legis/BillInfo.aspx?s=${head.session_name}&b=${encodeURIComponent(head.bill_number)}`}
                    target="_blank"
                    rel="noreferrer"
                    style={{ color: 'var(--app-link-ext)' }}
                >
                    {head.bill_number} on legis.la.gov ↗
                </a>
                {head.pdf_doc_id && (
                    <>
                        {'  ·  '}
                        <a
                            href={`https://legis.la.gov/legis/ViewDocument.aspx?d=${head.pdf_doc_id}`}
                            target="_blank"
                            rel="noreferrer"
                            style={{ color: 'var(--app-link-ext)' }}
                        >
                            roll-call PDF ↗
                        </a>
                    </>
                )}
            </p>

            <section style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '1.5rem' }}>
                {[1, 2, 3, 4].map((v) => (
                    <div key={v}>
                        <h3 style={{ margin: 0, borderBottom: '2px solid var(--app-ink)', paddingBottom: '0.3rem', fontSize: '0.9rem', letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                            {VOTE_LABEL[v]} · {byVote[v].length}
                        </h3>
                        <ul style={{ listStyle: 'none', padding: 0, margin: '0.5rem 0 0', fontFamily: 'ui-monospace, monospace', fontSize: '0.85rem' }}>
                            {byVote[v].map((m) => (
                                <li key={m.people_id} style={{ padding: '0.15rem 0', borderBottom: '1px solid var(--app-border-divider)' }}>
                                    <a href={`#/legislator/${m.people_id}`} style={{ color: 'var(--app-link)' }}>
                                        {formatName(m)}
                                    </a>
                                    <span style={{ color: partyColor(m.party), marginLeft: '0.4rem', fontWeight: 600 }}>{m.party ?? ''}</span>
                                    {m.district && <span style={{ color: 'var(--app-text-subtle)' }}> · D{m.district}</span>}
                                    <ProvenanceBadge source={m.source} />
                                </li>
                            ))}
                        </ul>
                    </div>
                ))}
            </section>
        </>
    );
}
