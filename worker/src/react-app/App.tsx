import { useEffect, useState } from 'react';

type Legislator = {
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
};

function formatName(l: Legislator) {
    const nick = l.nickname ? ` "${l.nickname}"` : '';
    const suffix = l.suffix ? `, ${l.suffix}` : '';
    return `${l.last_name}${suffix}, ${l.first_name}${nick}`;
}

function App() {
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
        <main style={{ maxWidth: 960, margin: '0 auto', padding: '2rem 1rem', fontFamily: 'Georgia, serif' }}>
            <h1 style={{ margin: 0, fontSize: '2rem' }}>Louisiana Legislator Vote Tracker</h1>
            <p style={{ color: '#666', marginTop: '0.25rem' }}>
                Find your legislator and (soon) browse their voting record.
            </p>

            <div style={{ display: 'flex', gap: '0.75rem', marginTop: '1.5rem', flexWrap: 'wrap' }}>
                <input
                    type="search"
                    placeholder="Search by name…"
                    value={q}
                    onChange={(e) => setQ(e.target.value)}
                    style={{ flex: '1 1 200px', padding: '0.5rem 0.75rem', fontSize: '1rem', border: '1px solid #ccc' }}
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

            <p style={{ color: '#666', marginTop: '1rem' }}>
                {loading ? 'Loading…' : `${legislators.length} legislator${legislators.length === 1 ? '' : 's'}`}
            </p>

            <table style={{ width: '100%', borderCollapse: 'collapse', marginTop: '0.5rem', fontFamily: 'ui-monospace, monospace', fontSize: '0.9rem' }}>
                <thead>
                    <tr style={{ borderBottom: '2px solid #222', textAlign: 'left' }}>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Name</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Party</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>Chamber</th>
                        <th style={{ padding: '0.5rem 0.25rem' }}>District</th>
                    </tr>
                </thead>
                <tbody>
                    {legislators.map((l) => (
                        <tr key={l.people_id} style={{ borderBottom: '1px solid #eee' }}>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{formatName(l)}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{l.party ?? '—'}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{l.role ?? '—'}</td>
                            <td style={{ padding: '0.4rem 0.25rem' }}>{l.district ?? '—'}</td>
                        </tr>
                    ))}
                </tbody>
            </table>
        </main>
    );
}

export default App;
