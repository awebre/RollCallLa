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

export type AgendaCategory =
    | 'final_passage'   // Third Reading and Final Passage / Final Consideration
    | 'concurrence'     // Concurrence votes and conference committee reports
    | 'second_reading'  // Second reading — referred to committee, no floor vote
    | 'introduction'    // Introduction of bills / resolutions
    | 'deferred'        // Lying over / postponed
    | 'other';

export type AgendaItem = {
    /** Normalised bill number, e.g. "HB 255" */
    bill_number: string;
    /** Author name as printed on the agenda */
    author: string;
    /** Short description / subject from the agenda */
    subject: string;
    /** Status derived from CSS class on the row */
    status: 'future' | 'current' | 'past';
    /** Category derived from the agenda section header */
    category: AgendaCategory;
};

export type AgendaResult = {
    chamber: 'H' | 'S';
    date: string | null;
    time: string | null;
    location: string | null;
    items: AgendaItem[];
    /** true when the floor session is actively in progress (hideMeetingStatus = 2) */
    in_progress: boolean;
    /** true when the floor session has adjourned for the day (hideMeetingStatus = -2) */
    adjourned: boolean;
    /** ISO timestamp of when this data was fetched */
    fetched_at: string;
    /** true when the agenda page was reachable and parseable */
    ok: boolean;
    error?: string;
};

const CACHE_TTL_LIVE_SECONDS  =       60; // 1 minute  — session in progress
const CACHE_TTL_IDLE_SECONDS  = 30 * 60; // 30 minutes — no active session
const UPSTREAM_TIMEOUT_MS = 8_000;

/** Normalise "HB255" → "HB 255", "SB12" → "SB 12", etc. */
function normaliseBillNumber(raw: string): string {
    return raw.trim().replace(/^([A-Z]+)(\d+)$/, '$1 $2');
}

/** Map a raw agenda section header to a normalised category. */
function categoriseSection(header: string): AgendaCategory {
    const h = header.toLowerCase();
    // "Final Passage" (House) and "Final Passage" (Senate) both contain this phrase.
    // "to be Adopted" catches Senate resolution final consideration sections.
    if (h.includes('final passage') || h.includes('final consideration') || h.includes('to be adopted')) return 'final_passage';
    // "Returned from" covers Senate concurrence sections; "concur" and "conference" cover the rest.
    if (h.includes('concur') || h.includes('conference') || h.includes('returned from')) return 'concurrence';
    // Senate uses "2nd Reading"; House uses "Second Reading". Both need to match.
    if (h.includes('second reading') || h.includes('2nd reading') || h.includes('reported by committee')) return 'second_reading';
    if (h.includes('introduction')) return 'introduction';
    if (h.includes('lying over')) return 'deferred';
    return 'other';
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

    // hideMeetingStatus: 2 = in progress, -2 = adjourned, other = not yet started.
    const meetingStatusMatch = html.match(/hideMeetingStatus[^>]*value="(-?\d+)"/);
    const meetingStatus = meetingStatusMatch ? Number(meetingStatusMatch[1]) : 0;
    const in_progress = meetingStatus === 2;
    const adjourned   = meetingStatus === -2;

    const items: AgendaItem[] = [];

    // Find the agenda table
    const tableStart = html.indexOf('id="TableAgendaItems"');
    if (tableStart === -1) return { date, time, location, in_progress, adjourned, items };

    // The table contains ~50 nested <table> elements, so the first </table> after
    // tableStart closes an inner table, not the outer one. Walk forward tracking
    // nesting depth to find the real closing tag for TableAgendaItems.
    let tableEnd = -1;
    let depth = 0;
    const tagPattern = /<\/?table/gi;
    tagPattern.lastIndex = tableStart;
    let tagMatch: RegExpExecArray | null;
    while ((tagMatch = tagPattern.exec(html)) !== null) {
        if (tagMatch[0].startsWith('</')) {
            if (depth === 0) { tableEnd = tagMatch.index; break; }
            depth--;
        } else {
            depth++;
        }
    }
    const tableHtml = html.slice(tableStart, tableEnd === -1 ? undefined : tableEnd + 8);

    // Match each <tr>...</tr> block
    const trPattern = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
    let trMatch: RegExpExecArray | null;
    let currentCategory: AgendaCategory = 'other';

    while ((trMatch = trPattern.exec(tableHtml)) !== null) {
        const rowHtml = trMatch[0];
        const rowContent = trMatch[1];

        // Section header rows have a single colspan="5" cell with the section title.
        const headerMatch = rowContent.match(/colspan="5"[^>]*>([\s\S]*?)<\/td>/i);
        if (headerMatch) {
            const headerText = headerMatch[1].replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
            // "Scheduled for…" and "Not yet scheduled…" rows are scheduling annotations,
            // not new sections — skip them so the category set by the real section header
            // above is preserved for all bills within that section.
            if (headerText && !/^(scheduled|not yet scheduled)/i.test(headerText)) {
                currentCategory = categoriseSection(headerText);
            }
            continue;
        }

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
                category: currentCategory,
            });
        }
    }

    return { date, time, location, in_progress, adjourned, items };
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

    const { date, time, location, in_progress, adjourned, items } = parseAgendaText(html);

    const result: AgendaResult = {
        chamber,
        date,
        time,
        location,
        in_progress,
        adjourned,
        items,
        fetched_at: new Date().toISOString(),
        ok: true,
    };

    // Use a shorter TTL when the session is actively in progress.
    const ttl = result.in_progress ? CACHE_TTL_LIVE_SECONDS : CACHE_TTL_IDLE_SECONDS;

    // Store in edge cache with manual expires_at for local dev compatibility.
    const payload = { ...result, expires_at: Date.now() + ttl * 1000 };
    const cacheResponse = new Response(JSON.stringify(payload), {
        headers: {
            'Content-Type': 'application/json',
            'Cache-Control': `public, max-age=${ttl}`,
        },
    });
    await cache.put(cacheKey, cacheResponse);

    return result;
}
