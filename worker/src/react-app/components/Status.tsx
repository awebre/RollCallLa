import { useEffect, useState } from 'react';

type StatusData = {
    counts: { bills: number; roll_calls: number; votes: number; active_legislators: number };
    last_refresh: string | null;
};

export function Status() {
    const [data, setData] = useState<StatusData | null>(null);
    useEffect(() => {
        fetch('/api/status').then((r) => r.json() as Promise<StatusData>).then(setData);
    }, []);
    if (!data) return null;
    const { bills, roll_calls, votes, active_legislators } = data.counts;
    return (
        <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.85rem', fontFamily: 'ui-monospace, monospace' }}>
            {active_legislators.toLocaleString()} legislators · {bills.toLocaleString()} bills ·{' '}
            {roll_calls.toLocaleString()} roll calls · {votes.toLocaleString()} votes
        </p>
    );
}
