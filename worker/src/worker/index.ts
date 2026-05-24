import { Hono } from 'hono';
import { admin } from './admin';
import { fetchChamberAgenda } from './agenda';

const app = new Hono<{ Bindings: Env }>();

app.route('/api/admin', admin);

// Read endpoints are eventually-consistent with a once-weekly refresh job.
// 10-minute browser/edge cache hides cold-D1 latency on the heavier queries
// without making the data feel stale.
const CACHE = 'public, max-age=600';

app.get('/api/', (c) => c.json({ name: 'Cloudflare' }));

const GEO_FILES = new Set(['house.json', 'senate.json', 'zip-districts.json']);

app.get('/geo/:vintage/:file', async (c) => {
    const { vintage, file } = c.req.param();
    if (!GEO_FILES.has(file)) return c.notFound();
    const obj = await c.env.GEO_ASSETS.get(`${vintage}/${file}`);
    if (!obj) return c.notFound();
    c.header('Content-Type', 'application/json');
    c.header('Cache-Control', 'public, max-age=31536000, immutable');
    return c.body(obj.body);
});

// ── sessions ─────────────────────────────────────────────────────────────────
// API field names mirror the new schema: `id` (surrogate), `name`, `year`,
// `type` ('regular'|'special'), `map_vintage`. Frontend types updated to match.
app.get('/api/sessions', async (c) => {
    const db = c.env.la_vote_tracker;
    const { results } = await db.prepare(
        `SELECT id, name, year, type, start_date, end_date, map_vintage
         FROM sessions ORDER BY year DESC, id DESC`,
    ).all();
    c.header('cache-control', CACHE);
    return c.json({ sessions: results });
});

// ── status / counts ──────────────────────────────────────────────────────────
app.get('/api/status', async (c) => {
    const db = c.env.la_vote_tracker;
    const sessionId = Number(c.req.query('session_id')) || null;

    // When scoped, restrict every count to that session via FK joins.
    // "active_legislators" becomes "session members" — explicit roster membership
    // rather than the inferred-from-votes count the old code did, since
    // legislator_sessions is now the source of truth for who served when.
    const queries = sessionId
        ? [
            db.prepare(`SELECT COUNT(*) AS n FROM bills WHERE session_id = ?`).bind(sessionId),
            db.prepare(`SELECT COUNT(*) AS n FROM roll_calls WHERE session_id = ?`).bind(sessionId),
            db.prepare(
                `SELECT COUNT(*) AS n FROM votes v
                 JOIN roll_calls rc ON rc.id = v.roll_call_id
                 WHERE rc.session_id = ?`,
            ).bind(sessionId),
            db.prepare(
                `SELECT COUNT(*) AS n FROM legislator_sessions
                 WHERE session_id = ? AND active = 1`,
            ).bind(sessionId),
        ]
        : [
            db.prepare(`SELECT COUNT(*) AS n FROM bills`),
            db.prepare(`SELECT COUNT(*) AS n FROM roll_calls`),
            db.prepare(`SELECT COUNT(*) AS n FROM votes`),
            db.prepare(`SELECT COUNT(DISTINCT legislator_id) AS n FROM legislator_sessions WHERE active = 1`),
        ];

    const [bills, rolls, votes, legs, ingest] = await db.batch([
        ...queries,
        db.prepare(
            `SELECT finished_at, trigger FROM ingest_runs
             WHERE status = 'success'
             ORDER BY id DESC LIMIT 1`,
        ),
    ]);
    const last = ingest.results[0] as { finished_at: string; trigger: string } | undefined;
    c.header('cache-control', CACHE);
    return c.json({
        counts: {
            bills: (bills.results[0] as { n: number }).n,
            roll_calls: (rolls.results[0] as { n: number }).n,
            votes: (votes.results[0] as { n: number }).n,
            active_legislators: (legs.results[0] as { n: number }).n,
        },
        scoped_to_session: sessionId,
        last_refresh: last?.finished_at ?? null,
        last_refresh_trigger: last?.trigger ?? null,
    });
});

// ── legislators list ─────────────────────────────────────────────────────────
// Returns one row per legislator scoped to a session (the per-session role/
// party/district come from legislator_sessions). Without `session_id` the
// endpoint falls back to the most recent session so the roster page always
// has session context.
app.get('/api/legislators', async (c) => {
    const db = c.env.la_vote_tracker;
    const { chamber, party, q, active, session_id } = c.req.query();
    let sessionId = Number(session_id) || null;

    // Default to most-recent session if not supplied.
    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const where: string[] = [];
    const binds: (string | number)[] = [];
    if (chamber === 'H' || chamber === 'S') {
        where.push('l.chamber = ?');
        binds.push(chamber);
    }
    if (party) {
        where.push('ls.party = ?');
        binds.push(party.toUpperCase());
    }
    if (active === '1' || active === '0') {
        where.push('ls.active = ?');
        binds.push(Number(active));
    }
    if (q) {
        where.push('(l.last_name LIKE ? OR l.first_name LIKE ? OR l.nickname LIKE ?)');
        const like = `%${q}%`;
        binds.push(like, like, like);
    }

    // Join legislator_sessions for the supplied session. INNER join naturally
    // restricts to people who served in that session — same effect as the old
    // "voted in this session" subquery but cheaper + more accurate (roster
    // members who never cast a vote still appear).
    const sql = `
        SELECT l.id, l.chamber, l.source_id, l.first_name, l.last_name, l.suffix, l.nickname,
               ls.role, ls.party, ls.district, ls.active, l.source,
               ls.term_start, ls.term_end, ls.year_elected
        FROM legislators l
        JOIN legislator_sessions ls ON ls.legislator_id = l.id
        WHERE ls.session_id = ?
        ${where.length ? 'AND ' + where.join(' AND ') : ''}
        ORDER BY l.last_name, l.first_name
    `;
    const { results } = await db.prepare(sql).bind(sessionId, ...binds).all();
    c.header('cache-control', CACHE);
    return c.json({ legislators: results, session_id: sessionId });
});

// ── bills list ──────────────────────────────────────────────────────────────
// Returns bills scoped to a session with the filters the UI exposes. No joins
// to roll_calls/votes — pure metadata view that's cheap and fast.
app.get('/api/bills', async (c) => {
    const db = c.env.la_vote_tracker;
    const { chamber, type, stage, next_chamber, q, session_id, limit: limitStr, offset: offsetStr } = c.req.query();
    let sessionId = Number(session_id) || null;

    // Default to most-recent session if not supplied.
    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const where: string[] = ['session_id = ?'];
    const binds: (string | number)[] = [sessionId ?? 0];
    if (chamber === 'H' || chamber === 'S') {
        where.push('originating_chamber = ?');
        binds.push(chamber);
    }
    if (type) {
        where.push('bill_type = ?');
        binds.push(type.toUpperCase());
    }
    if (stage) {
        where.push('pipeline_stage = ?');
        binds.push(stage);
    }
    if (next_chamber === 'H' || next_chamber === 'S') {
        where.push('next_chamber = ?');
        binds.push(next_chamber);
    }
    if (q) {
        where.push('(bill_number LIKE ? OR title LIKE ?)');
        const like = `%${q}%`;
        binds.push(like, like);
    }

    const limit = Math.min(Number(limitStr) || 50, 200);
    const offset = Math.max(Number(offsetStr) || 0, 0);

    // Use a CTE to share the WHERE clause for the total count and the page.
    // Bill ordering by chamber-then-number sorts HBs together then SBs etc.;
    // the secondary CAST sorts numerically inside the type so HB2 comes before HB10.
    const sql = `
        SELECT id, bill_number, bill_type, originating_chamber, title,
               pipeline_stage, next_chamber, status_text, docs_id
        FROM bills
        WHERE ${where.join(' AND ')}
        ORDER BY bill_type, CAST(SUBSTR(bill_number, LENGTH(bill_type) + 1) AS INTEGER)
        LIMIT ? OFFSET ?
    `;
    const countSql = `SELECT COUNT(*) AS n FROM bills WHERE ${where.join(' AND ')}`;
    const [page, total] = await db.batch([
        db.prepare(sql).bind(...binds, limit, offset),
        db.prepare(countSql).bind(...binds),
    ]);
    c.header('cache-control', CACHE);
    return c.json({
        bills: page.results,
        total: (total.results[0] as { n: number }).n,
        limit,
        offset,
        session_id: sessionId,
    });
});

// ── legislator detail ───────────────────────────────────────────────────────
app.get('/api/legislators/:id', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
    let sessionId = Number(c.req.query('session_id')) || null;

    // Default to most recent session for per-session fields (role, party, etc.).
    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    // Profile combines person-level data (legislators) with session-specific data
    // (legislator_sessions). LEFT JOIN on the session so pdf-only legislators with
    // no session record still resolve — their session-specific fields come back null.
    const [profile, tally, partyLine] = await db.batch([
        db.prepare(
            `SELECT l.id, l.chamber, l.source_id, l.first_name, l.last_name, l.suffix, l.nickname, l.source,
                    ls.role, ls.party, ls.district, ls.active,
                    ls.term_start, ls.term_end, ls.year_elected
             FROM legislators l
             LEFT JOIN legislator_sessions ls
                ON ls.legislator_id = l.id AND ls.session_id = ?
             WHERE l.id = ?`,
        ).bind(sessionId, id),
        db.prepare(
            `SELECT vote, COUNT(*) AS n
             FROM votes v
             JOIN roll_calls rc ON rc.id = v.roll_call_id
             WHERE v.legislator_id = ? AND rc.vote_category = 'final_passage'
               AND rc.session_id = ?
             GROUP BY vote`,
        ).bind(id, sessionId),
        // Party Unity Score (standard CQ/GovTrack method):
        // for each final-passage roll call, determine the party's majority position
        // (whichever of Yea/Nay got more same-party same-chamber votes), then check
        // whether this legislator voted with that majority. Score = aligned / total.
        // Party + chamber come from the SUBJECT's legislator_sessions row for the
        // scoped session — not from legislators (which has no role anyway now).
        db.prepare(
            `WITH legi AS (
                SELECT ls.party, l.chamber
                FROM legislators l
                JOIN legislator_sessions ls
                    ON ls.legislator_id = l.id AND ls.session_id = ?
                WHERE l.id = ?
             ),
             party_majority AS (
                SELECT
                    v2.roll_call_id,
                    CASE WHEN SUM(CASE WHEN v2.vote = 1 THEN 1 ELSE 0 END) >=
                              SUM(CASE WHEN v2.vote = 2 THEN 1 ELSE 0 END)
                         THEN 1 ELSE 2 END AS majority_vote
                FROM votes v2
                JOIN legislators l2          ON l2.id = v2.legislator_id
                JOIN legislator_sessions ls2 ON ls2.legislator_id = l2.id AND ls2.session_id = ?
                JOIN legi ON legi.party = ls2.party AND legi.chamber = l2.chamber
                JOIN roll_calls rc ON rc.id = v2.roll_call_id
                WHERE v2.vote IN (1, 2) AND rc.vote_category = 'final_passage'
                  AND rc.session_id = ?
                GROUP BY v2.roll_call_id
             )
             SELECT
                COUNT(*) FILTER (WHERE v.vote = pm.majority_vote) AS aligned,
                COUNT(*) AS total
             FROM votes v
             JOIN party_majority pm ON pm.roll_call_id = v.roll_call_id
             WHERE v.legislator_id = ? AND v.vote IN (1, 2)`,
        ).bind(sessionId, id, sessionId, sessionId, id),
    ]);

    if (profile.results.length === 0) return c.json({ error: 'not found' }, 404);

    const tally_by_vote: Record<string, number> = { '1': 0, '2': 0, '3': 0, '4': 0 };
    for (const row of tally.results as { vote: number; n: number }[]) {
        tally_by_vote[String(row.vote)] = row.n;
    }
    const pl = partyLine.results[0] as { aligned: number; total: number };

    c.header('cache-control', CACHE);
    return c.json({
        legislator: profile.results[0],
        final_passage_tally: {
            yea: tally_by_vote['1'],
            nay: tally_by_vote['2'],
            nv: tally_by_vote['3'],
            absent: tally_by_vote['4'],
        },
        party_line: pl?.total ? Math.round((pl.aligned / pl.total) * 100) : null,
        session_id: sessionId,
    });
});

// ── legislator vote history ─────────────────────────────────────────────────
app.get('/api/legislators/:id/votes', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);

    const {
        session_id, chamber, category, passed, close, from, to, q, vote,
        limit: limitStr, offset: offsetStr,
    } = c.req.query();

    // Binds appended in two clusters: legislator filter first, then WHERE filters,
    // then LIMIT/OFFSET. Order preserved as cleanly as possible.
    const binds: (string | number)[] = [id];
    const where: string[] = [];
    if (session_id) {
        where.push('rc.session_id = ?');
        binds.push(Number(session_id));
    }
    if (chamber === 'H' || chamber === 'S') {
        where.push('rc.chamber = ?');
        binds.push(chamber);
    }
    if (category) {
        where.push('rc.vote_category = ?');
        binds.push(category);
    }
    if (passed === '1' || passed === '0') {
        where.push('rc.passed = ?');
        binds.push(Number(passed));
    }
    if (close === '1') {
        where.push('rc.margin <= 10');
    }
    if (from) {
        where.push('rc.date >= ?');
        binds.push(from);
    }
    if (to) {
        where.push('rc.date <= ?');
        binds.push(to);
    }
    if (q) {
        where.push('(b.bill_number LIKE ? OR b.title LIKE ?)');
        const like = `%${q}%`;
        binds.push(like, like);
    }
    if (vote && /^[1-4]$/.test(vote)) {
        where.push('v.vote = ?');
        binds.push(Number(vote));
    }

    const limit = Math.min(Number(limitStr) || 50, 200);
    const offset = Math.max(Number(offsetStr) || 0, 0);
    binds.push(limit, offset);

    const sql = `
        SELECT
            rc.id AS roll_call_id, rc.date, rc.chamber, rc.description, rc.vote_category,
            rc.yea, rc.nay, rc.nv, rc.absent, rc.total, rc.passed, rc.margin,
            rc.pdf_doc_id,
            b.id AS bill_id, b.bill_number, b.title,
            v.vote AS cast_vote
        FROM votes v
        JOIN roll_calls rc ON rc.id = v.roll_call_id
        JOIN bills b       ON b.id  = rc.bill_id
        WHERE v.legislator_id = ?
        ${where.length > 0 ? 'AND ' + where.join(' AND ') : ''}
        ORDER BY rc.date DESC, rc.id DESC
        LIMIT ? OFFSET ?
    `;
    const { results } = await db.prepare(sql).bind(...binds).all();
    c.header('cache-control', CACHE);
    return c.json({ votes: results, limit, offset });
});

// ── roll-call detail ────────────────────────────────────────────────────────
app.get('/api/rollcalls/:id', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);

    // The member list joins legislator_sessions for the same session as the roll
    // call so role/party/district reflect what they were AT THE TIME, not current.
    const [head, members] = await db.batch([
        db.prepare(
            `SELECT rc.id AS roll_call_id, rc.bill_id, rc.date, rc.chamber, rc.description,
                    rc.vote_category, rc.yea, rc.nay, rc.nv, rc.absent, rc.total,
                    rc.passed, rc.margin, rc.pdf_doc_id,
                    b.bill_number, b.title,
                    s.name AS session_name, s.id AS session_id
             FROM roll_calls rc
             JOIN bills b    ON b.id = rc.bill_id
             JOIN sessions s ON s.id = rc.session_id
             WHERE rc.id = ?`,
        ).bind(id),
        db.prepare(
            `SELECT v.vote,
                    l.id AS legislator_id, l.chamber, l.source_id,
                    l.first_name, l.last_name, l.suffix, l.nickname,
                    l.source,
                    ls.role, ls.party, ls.district
             FROM votes v
             JOIN legislators l ON l.id = v.legislator_id
             JOIN roll_calls rc ON rc.id = v.roll_call_id
             LEFT JOIN legislator_sessions ls
                ON ls.legislator_id = l.id AND ls.session_id = rc.session_id
             WHERE v.roll_call_id = ?
             ORDER BY l.last_name, l.first_name`,
        ).bind(id),
    ]);

    if (head.results.length === 0) return c.json({ error: 'not found' }, 404);
    c.header('cache-control', CACHE);
    return c.json({ roll_call: head.results[0], members: members.results });
});

// ── committees list ──────────────────────────────────────────────────────────
// Returns committees filtered by chamber, with member count, party breakdown,
// and chair info for the session.  CTEs compute party counts and chair lookup
// separately so the main query stays a simple join.
app.get('/api/committees', async (c) => {
    const db = c.env.la_vote_tracker;
    const { chamber, session_id } = c.req.query();
    let sessionId = Number(session_id) || null;

    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const chamberFilter = (chamber === 'H' || chamber === 'S' || chamber === 'J') ? chamber : null;

    const sql = `
        WITH active AS (
            SELECT cm.committee_id, cm.legislator_id, cm.role
            FROM committee_memberships cm
            WHERE cm.session_id = ? AND cm.valid_to IS NULL
        ),
        party_counts AS (
            SELECT a.committee_id,
                   COUNT(*)                                              AS member_count,
                   SUM(CASE WHEN ls.party = 'R' THEN 1 ELSE 0 END)     AS republican_count,
                   SUM(CASE WHEN ls.party = 'D' THEN 1 ELSE 0 END)     AS democrat_count
            FROM active a
            LEFT JOIN legislator_sessions ls
                ON ls.legislator_id = a.legislator_id AND ls.session_id = ?
            GROUP BY a.committee_id
        ),
        chair_info AS (
            SELECT a.committee_id,
                   l.id    AS chair_legislator_id,
                   l.last_name  AS chair_last_name,
                   l.first_name AS chair_first_name,
                   l.suffix     AS chair_suffix
            FROM active a
            JOIN legislators l ON l.id = a.legislator_id
            WHERE a.role = 'chair'
        )
        SELECT c.id, c.slug, c.name, c.chamber, c.url,
               COALESCE(pc.member_count,     0) AS member_count,
               COALESCE(pc.republican_count, 0) AS republican_count,
               COALESCE(pc.democrat_count,   0) AS democrat_count,
               ci.chair_legislator_id,
               ci.chair_last_name,
               ci.chair_first_name,
               ci.chair_suffix
        FROM committees c
        LEFT JOIN party_counts pc ON pc.committee_id = c.id
        LEFT JOIN chair_info   ci ON ci.committee_id = c.id
        ${chamberFilter ? 'WHERE c.chamber = ?' : ''}
        ORDER BY c.name
    `;
    const binds: (string | number)[] = [sessionId ?? 0, sessionId ?? 0];
    if (chamberFilter) binds.push(chamberFilter);
    const { results } = await db.prepare(sql).bind(...binds).all();
    c.header('cache-control', CACHE);
    return c.json({ committees: results, session_id: sessionId });
});

// ── committee detail (members) ────────────────────────────────────────────────
app.get('/api/committees/:id', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
    let sessionId = Number(c.req.query('session_id')) || null;

    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const [committee, members] = await db.batch([
        db.prepare(`SELECT id, slug, name, chamber, url FROM committees WHERE id = ?`).bind(id),
        db.prepare(
            `SELECT cm.role,
                    l.id AS legislator_id, l.first_name, l.last_name, l.suffix, l.nickname, l.source,
                    ls.party, ls.district
             FROM committee_memberships cm
             JOIN legislators l ON l.id = cm.legislator_id
             LEFT JOIN legislator_sessions ls
                 ON ls.legislator_id = l.id AND ls.session_id = ?
             WHERE cm.committee_id = ? AND cm.session_id = ? AND cm.valid_to IS NULL
             ORDER BY
                 CASE cm.role WHEN 'chair' THEN 0 WHEN 'vice_chair' THEN 1
                              WHEN 'member' THEN 2 WHEN 'interim' THEN 3
                              WHEN 'ex_officio' THEN 4 ELSE 5 END,
                 l.last_name, l.first_name`,
        ).bind(sessionId, id, sessionId),
    ]);

    if (committee.results.length === 0) return c.json({ error: 'not found' }, 404);
    c.header('cache-control', CACHE);
    return c.json({ committee: committee.results[0], members: members.results, session_id: sessionId });
});

// ── committee bills (referrals) ───────────────────────────────────────────────
app.get('/api/committees/:id/bills', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
    let sessionId = Number(c.req.query('session_id')) || null;

    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const { results } = await db.prepare(
        `SELECT bcr.id AS referral_id,
                bcr.referral_date, bcr.discharge_date, bcr.outcome,
                b.id AS bill_id, b.bill_number, b.bill_type, b.originating_chamber,
                b.title, b.pipeline_stage
         FROM bill_committee_referrals bcr
         JOIN bills b ON b.id = bcr.bill_id
         WHERE bcr.committee_id = ? AND b.session_id = ?
         ORDER BY bcr.referral_date DESC, b.bill_number`,
    ).bind(id, sessionId).all();

    c.header('cache-control', CACHE);
    return c.json({ referrals: results, session_id: sessionId });
});

// ── legislator committees ─────────────────────────────────────────────────────
app.get('/api/legislators/:id/committees', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
    let sessionId = Number(c.req.query('session_id')) || null;

    if (sessionId === null) {
        const latest = await db.prepare(
            `SELECT id FROM sessions ORDER BY year DESC, id DESC LIMIT 1`,
        ).first<{ id: number }>();
        sessionId = latest?.id ?? null;
    }

    const { results } = await db.prepare(
        `SELECT cm.role, c.id AS committee_id, c.name AS committee_name,
                c.chamber AS committee_chamber, c.url AS committee_url
         FROM committee_memberships cm
         JOIN committees c ON c.id = cm.committee_id
         WHERE cm.legislator_id = ? AND cm.session_id = ? AND cm.valid_to IS NULL
         ORDER BY
             CASE cm.role WHEN 'chair' THEN 0 WHEN 'vice_chair' THEN 1
                          WHEN 'member' THEN 2 WHEN 'interim' THEN 3
                          WHEN 'ex_officio' THEN 4 ELSE 5 END,
             c.name`,
    ).bind(id, sessionId).all();

    c.header('cache-control', CACHE);
    return c.json({ committees: results, session_id: sessionId });
});

// ── floor agenda passthrough ────────────────────────────────────────────────
app.get('/api/agenda/:chamber', async (c) => {
    const raw = c.req.param('chamber').toUpperCase();
    if (raw !== 'H' && raw !== 'S') return c.json({ error: 'chamber must be H or S' }, 400);
    const result = await fetchChamberAgenda(raw, caches);
    // Don't cache the Worker response itself — the agenda module manages cache internally.
    return c.json(result);
});

// ── feedback ────────────────────────────────────────────────────────────────
const CATEGORY_LABELS: Record<string, string> = {
    representative: 'Representative info',
    vote: 'Vote info',
    bill: 'Bill info',
    map: 'Map / boundary',
};

app.post('/api/feedback', async (c) => {
    const body = await c.req.json<{
        category?: string;
        description?: string;
        email?: string | null;
        turnstileToken?: string;
    }>();
    const { category, description, email, turnstileToken } = body;

    if (!category || !CATEGORY_LABELS[category] || !description?.trim() || !turnstileToken) {
        return c.json({ error: 'missing fields' }, 400);
    }

    // Verify Turnstile token
    const form = new FormData();
    form.append('secret', c.env.TURNSTILE_SECRET as string);
    form.append('response', turnstileToken);
    const tsRes = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST', body: form,
    });
    const ts = await tsRes.json<{ success: boolean }>();
    if (!ts.success) return c.json({ error: 'verification failed' }, 400);

    const subject = `[Roll Call LA] Data issue: ${CATEGORY_LABELS[category]}`;
    const body_text = [
        `Category: ${CATEGORY_LABELS[category]}`,
        '',
        description.trim(),
        ...(email ? ['', `Reporter: ${email}`] : []),
    ].join('\n');

    const replyToHeader = email ? `Reply-To: ${email}\r\n` : '';
    const rawEmail = [
        `From: ${c.env.FEEDBACK_FROM_EMAIL}`,
        `To: austin@go-validate.com`,
        `Subject: ${subject}`,
        replyToHeader.trimEnd(),
        'Content-Type: text/plain; charset=utf-8',
        'MIME-Version: 1.0',
        '',
        body_text,
    ].filter(s => s !== undefined).join('\r\n');

    await c.env.la_vote_tracker.prepare(
        `INSERT INTO feedback (category, description, email) VALUES (?, ?, ?)`,
    ).bind(category, description.trim(), email ?? null).run();

    if (c.env.SEND_EMAIL) {
        // @ts-ignore — cloudflare:email is a virtual module available at runtime only
        const { EmailMessage } = await import('cloudflare:email');
        const msg = new EmailMessage(c.env.FEEDBACK_FROM_EMAIL, 'austin@go-validate.com', rawEmail);
        await c.env.SEND_EMAIL.send(msg);
    } else {
        console.log('[feedback - email not sent in local dev]\n', rawEmail);
    }

    return c.json({ ok: true });
});

export default app;
