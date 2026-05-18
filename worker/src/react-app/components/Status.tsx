import { useEffect, useState } from 'react';
import { useSession } from '../SessionContext';

type StatusData = {
    counts: { bills: number; roll_calls: number; votes: number; active_legislators: number };
    last_refresh: string | null;
    last_refresh_trigger: string | null;
};

// Tri-state freshness coloring. Refresh job runs nightly, so any healthy
// state sits below 24h. >24h means at least one scheduled run has missed.
const FRESH_HOURS = 12;
const STALE_HOURS = 24;

function freshnessColor(hoursAgo: number): string {
    if (hoursAgo < FRESH_HOURS) return '#1d6b3a';   // green — fresh
    if (hoursAgo < STALE_HOURS) return '#7a6a3a';   // amber — getting old
    return '#a32a2a';                                // red — stale
}

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
        const stale = hoursAgo >= STALE_HOURS;
        refreshNode = (
            <>
                {' · '}
                <span
                    title={`Data refreshed ${data.last_refresh} UTC${data.last_refresh_trigger ? ` (${data.last_refresh_trigger})` : ''}`}
                    style={{ color: freshnessColor(hoursAgo), fontWeight: 600 }}
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
