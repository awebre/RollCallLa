import { useEffect, useState } from 'react';
import { useSession } from '../SessionContext';

type StatusData = {
    counts: { bills: number; roll_calls: number; votes: number; active_legislators: number };
    last_refresh: string | null;
    last_refresh_trigger: string | null;
};

// Tag a refresh as "stale" past this many hours. Refresh job runs nightly, so
// >36h means at least one run has missed.
const STALE_HOURS = 36;

function relativeTime(iso: string): { label: string; hoursAgo: number } {
    // SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' in UTC, no 'T' or 'Z'.
    // Normalize to an ISO string the Date parser understands across browsers.
    const asIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
    const then = new Date(asIso).getTime();
    const now = Date.now();
    const diffMs = Math.max(0, now - then);
    const hoursAgo = diffMs / (1000 * 60 * 60);
    if (hoursAgo < 1) return { label: 'just now', hoursAgo };
    if (hoursAgo < 24) return { label: `${Math.round(hoursAgo)}h ago`, hoursAgo };
    const days = Math.round(hoursAgo / 24);
    return { label: `${days}d ago`, hoursAgo };
}

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

    let refreshNode = null;
    if (data.last_refresh) {
        const { label, hoursAgo } = relativeTime(data.last_refresh);
        const stale = hoursAgo > STALE_HOURS;
        refreshNode = (
            <>
                {' · '}
                <span
                    title={`Data refreshed ${data.last_refresh} UTC${data.last_refresh_trigger ? ` (${data.last_refresh_trigger})` : ''}`}
                    style={{ color: stale ? '#a32a2a' : '#666' }}
                >
                    refreshed {label}{stale ? ' (stale)' : ''}
                </span>
            </>
        );
    }

    return (
        <p style={{ margin: '0.25rem 0 0', color: '#666', fontSize: '0.85rem', fontFamily: 'ui-monospace, monospace' }}>
            {active_legislators.toLocaleString()} {legLabel} · {bills.toLocaleString()} bills ·{' '}
            {roll_calls.toLocaleString()} roll calls · {votes.toLocaleString()} votes
            {refreshNode}
        </p>
    );
}
