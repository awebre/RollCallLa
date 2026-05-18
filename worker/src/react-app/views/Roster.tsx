import { useEffect, useState } from 'react';
import type { Legislator } from '../types';
import { formatName, partyColor } from '../types';

export function Roster() {
    const [legislators, setLegislators] = useState<Legislator[]>([]);
    const [loading, setLoading] = useState(true);
    const [chamber, setChamber] = useState<'' | 'H' | 'S'>('');
    const [party, setParty] = useState<'' | 'D' | 'R' | 'I'>('');
    const [q, setQ] = useState('');

    useEffect(() => {
        const params = new URLSearchParams();
        if (chamber) params.set('chamber', chamber);
        if (party) params.set('party', party);
        if (q) params.set('q', q);
        params.set('active', '1');
        setLoading(true);
        fetch(`/api/legislators?${params.toString()}`)
            .then((r) => r.json() as Promise<{ legislators: Legislator[] }>)
            .then((d) => setLegislators(d.legislators))
            .finally(() => setLoading(false));
    }, [chamber, party, q]);

    return (
        <>
            <p style={{ color: '#444', marginTop: 0 }}>
                Find your legislator. Click a name to see how they voted.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                <input
                    type="search"
                    placeholder="Search by name…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    style={{ flex: '1 1 220px', padding: '0.5rem 0.75rem', fontSize: '1rem', border: '1px solid #bbb' }}
                />
                <select value={chamber} onChange={(e) => setChamber(e.target.value as 'H' | 'S' | '')} style={{ padding: '0.5rem' }}>
                    <option value="">All chambers</option>
                    <option value="S">Senate</option>
                    <option value="H">House</option>
                </select>
                <select value={party} onChange={(e) => setParty(e.target.value as 'D' | 'R' | 'I' | '')} style={{ padding: '0.5rem' }}>
                    <option value="">All parties</option>
                    <option value="D">Democrat</option>
                    <option value="R">Republican</option>
                    <option value="I">Independent</option>
                </select>
            </div>

            <p style={{ color: '#666', marginTop: '1rem', fontSize: '0.9rem' }}>
                {loading ? 'Loading…' : `${legislators.length} legislator${legislators.length === 1 ? '' : 's'}`}
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid #1a1a1a', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Name</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Party</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Chamber</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>District</th>
                    </tr>
                </thead>
                <tbody>
                    {legislators.map((l) => (
                        <tr key={l.people_id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '0.4rem 0.25rem' }}>
                                <a href={`#/legislator/${l.people_id}`} style={{ color: '#1a1a1a' }}>
                                    {formatName(l)}
                                </a>
                            </td>
                            <td style={{ padding: '0.4rem 0.25rem', color: partyColor(l.party), fontWeight: 600 }}>{l.party ?? '—'}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{l.role ?? '—'}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{l.district ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </>
    );
}
