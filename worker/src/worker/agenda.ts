/**
 * Chamber floor agenda scraper.
 *
 * Fetches the Louisiana legislature's live agenda page for House or Senate,
 * parses bill rows, and returns structured JSON. No D1 cross-reference —
 * the agenda HTML already has everything we need (bill number, author, subject).
 *
 * Results are cached at the Cloudflare edge for CACHE_TTL_SECONDS so every
 * legislator in the same chamber shares one upstream fetch per cache window.
 */

export type AgendaItem = {
    /** Normalised bill number, e.g. "HB 255" */
    bill_number: string;
    /** Author name as printed on the agenda */
    author: string;
    /** Short description / subject from the agenda */
    subject: string;
    /** Status derived from CSS class on the row */
    status: 'future' | 'current' | 'past';
};

export type AgendaResult = {
    chamber: 'H' | 'S';
    date: string | null;
    time: string | null;
    location: string | null;
    items: AgendaItem[];
    /** ISO timestamp of when this data was fetched */
    fetched_at: string;
    /** true when the agenda page was reachable and parseable */
    ok: boolean;
    error?: string;
};

const CACHE_TTL_SECONDS = 5 * 60; // 5 minutes
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Normalise "HB255" → "HB 255", "SB12" → "SB 12", etc. */
function normaliseBillNumber(raw: string): string {
    return raw.trim().replace(/^([A-Z]+)(\d+)$/, '$1 $2');
}

/**
 * Text-based parser: extracts agenda items from the raw HTML string.
 */
function parseAgendaText(html: string): {
    date: string | null;
    time: string | null;
    location: string | null;
    items: AgendaItem[];
} {
    const extract = (id: string): string | null => {
        const m = html.match(new RegExp(`id="${id}"[^>]*>([^<]*)<`));
        return m ? m[1].trim() : null;
    };

    const date = extract('lDate');
    const time = extract('lTime');
    const location = extract('lLocation');

    const items: AgendaItem[] = [];

    // Find the agenda table
    const tableStart = html.indexOf('id="TableAgendaItems"');
    if (tableStart === -1) return { date, time, location, items };
    const tableEnd = html.indexOf('</table>', tableStart);
    const tableHtml = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd + 8);

    // Match each <tr>...</tr> block
    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;

    while ((trMatch = trPattern.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[0];
        const rowContent = trMatch[1];

        // Determine status from CSS class on any element in the row
        let status: AgendaItem['status'] = 'future';
        if (/CurrentItem/.test(rowHtml)) status = 'current';
        else if (/PastItem/.test(rowHtml)) status = 'past';

        // Extract cell text content, stripping all tags
        const tdPattern = /<td[^>]*>([\s\S]*?)<\/td>/gi;
        const cells: string[] = [];
        let tdMatch: RegExpExecArray | null;
        while ((tdMatch = tdPattern.exec(rowContent)) !== null) {
            const text = tdMatch[1]
                .replace(/<[^>]+>/g, ' ')
                .replace(/&amp;/g, '&')
                .replace(/&nbsp;/g, ' ')
                .replace(/&lt;/g, '<')
                .replace(/&gt;/g, '>')
                .replace(/&#\d+;/g, '')
                .replace(/\s+/g, ' ')
                .trim();
            cells.push(text);
        }

        // Bill rows have 5 cells: [item#, action, bill_number, author, subject]
        if (cells.length === 5) {
            const rawBill = cells[2];
            if (!/^[A-Z]{2,3}\d+/.test(rawBill)) continue;
            items.push({
                bill_number: normaliseBillNumber(rawBill),
                author: cells[3],
                subject: cells[4],
                status,
            });
        }
    }

    return { date, time, location, items };
}

export async function fetchChamberAgenda(
    chamber: 'H' | 'S',
    cacheStorage: CacheStorage,
): Promise<AgendaResult> {
    const cacheKey = `https://rollcall.la/__cache/agenda/${chamber}`;
    const cache = cacheStorage.default;

    // Check edge cache.
    // Production: Cloudflare edge enforces Cache-Control max-age automatically.
    // Local dev (Wrangler): cache.match() doesn't honour max-age, so we embed
    // expires_at in the payload and check it manually.
    const cached = await cache.match(cacheKey);
    if (cached) {
        const data = await cached.json<AgendaResult & { expires_at?: number }>();
        if (data.expires_at && Date.now() < data.expires_at) {
            return data;
        }
        // Expired or no expiry metadata — fall through to re-fetch
    }

    // Fetch from legis.la.gov
    const url = `https://legis.la.gov/legis/Agenda.aspx?c=${chamber}&g=BODY`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);

    let html: string;
    try {
        const upstream = await fetch(url, {
            signal: controller.signal,
            headers: { 'User-Agent': 'RollCallLA/1.0 (+https://rollcall.la)' },
        });
        if (!upstream.ok) throw new Error(`upstream ${upstream.status}`);
        html = await upstream.text();
    } catch (err) {
        return {
            chamber,
            date: null,
            time: null,
            location: null,
            items: [],
            fetched_at: new Date().toISOString(),
            ok: false,
            error: err instanceof Error ? err.message : String(err),
        };
    } finally {
        clearTimeout(timeout);
    }

    const { date, time, location, items } = parseAgendaText(html);

    const result: AgendaResult = {
        chamber,
        date,
        time,
        location,
        items,
        fetched_at: new Date().toISOString(),
        ok: true,
    };

    // Store in edge cache with manual expires_at for local dev compatibility.
    const payload = { ...result, expires_at: Date.now() + CACHE_TTL_SECONDS * 1000 };
    const cacheResponse = new Response(JSON.stringify(payload), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${CACHE_TTL_SECONDS}`,
        },
    });
    await cache.put(cacheKey, cacheResponse);

    return result;
}
