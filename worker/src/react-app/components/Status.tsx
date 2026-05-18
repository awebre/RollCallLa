import { useEffect, useState } from 'react';
import { useSession } from '../SessionContext';

type StatusData = {
    counts: { bills: number; roll_calls: number; votes: number; active_legislators: number };
    last_refresh: string | null;
};

export function Status() {
    const { current } = useSession();
    const [data, setData] = useState<StatusData | null>(null);
    useEffect(() => {
        const url = current ? `/api/status?session_id=${current.session_id}` : '/api/status';
        fetch(url).then((r) => r.json() as Promise<StatusData>).then(setData);
    }, [current?.session_id]);
    if (!data) return null;
    const { bills, roll_calls, votes, active_legislators } = data.counts;
    const legLabel = current ? 'legislators who voted' : 'legislators';
    return (
        <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.85rem', fontFamily: 'ui-monospace, monospace' }}>
            {active_legislators.toLocaleString()} {legLabel} · {bills.toLocaleString()} bills ·{' '}
            {roll_calls.toLocaleString()} roll calls · {votes.toLocaleString()} votes
        </p>
    );
}
