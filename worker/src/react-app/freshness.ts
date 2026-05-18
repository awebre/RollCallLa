// Pure helpers for the masthead's "refreshed Xh ago" pill. Extracted so the
// tri-state threshold + relative-time formatting are unit-testable.
//
// Tri-state coloring: refresh job runs nightly, so any healthy state sits
// below 24h. >=24h means at least one scheduled run has missed.
export const FRESH_HOURS = 12;
export const STALE_HOURS = 24;

export function freshnessColor(hoursAgo: number): string {
    if (hoursAgo < FRESH_HOURS) return '#1d6b3a';   // green — fresh
    if (hoursAgo < STALE_HOURS) return '#7a6a3a';   // amber — getting old
    return '#a32a2a';                                // red — stale
}

export function relativeTime(iso: string, now: number = Date.now()): { label: string; hoursAgo: number } {
    // SQLite's datetime('now') returns 'YYYY-MM-DD HH:MM:SS' in UTC, no 'T' or 'Z'.
    // Normalize to an ISO string the Date parser understands across browsers.
    const asIso = iso.includes('T') ? iso : iso.replace(' ', 'T') + 'Z';
    const then = new Date(asIso).getTime();
    const diffMs = Math.max(0, now - then);
    const hoursAgo = diffMs / (1000 * 60 * 60);
    if (hoursAgo < 1) return { label: 'just now', hoursAgo };
    if (hoursAgo < 24) return { label: `${Math.round(hoursAgo)}h ago`, hoursAgo };
    const days = Math.round(hoursAgo / 24);
    return { label: `${days}d ago`, hoursAgo };
}
