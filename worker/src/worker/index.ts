import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

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

app.get('/api/sessions', async (c) => {
    const db = c.env.la_vote_tracker;
    const { results } = await db.prepare(
        `SELECT session_id, name, year_start, year_end, special, map_vintage FROM sessions ORDER BY year_start DESC, session_id DESC`,
    ).all();
    c.header('cache-control', CACHE);
    return c.json({ sessions: results });
});

app.get('/api/status', async (c) => {
    const db = c.env.la_vote_tracker;
    const sessionId = Number(c.req.query('session_id')) || null;
    // When session_id is supplied, scope counts to that session. The legislators count
    // becomes "distinct members who voted in this session" — honest about turnover.
    const queries = sessionId
        ? [
            db.prepare(`SELECT COUNT(*) AS n FROM bills WHERE session_id = ?`).bind(sessionId),
            db.prepare(
                `SELECT COUNT(*) AS n FROM roll_calls rc
                 JOIN bills b ON b.bill_id = rc.bill_id
                 WHERE b.session_id = ?`,
            ).bind(sessionId),
            db.prepare(
                `SELECT COUNT(*) AS n FROM votes v
                 JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
                 JOIN bills b       ON b.bill_id      = rc.bill_id
                 WHERE b.session_id = ?`,
            ).bind(sessionId),
            db.prepare(
                `SELECT COUNT(DISTINCT v.people_id) AS n FROM votes v
                 JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
                 JOIN bills b       ON b.bill_id      = rc.bill_id
                 WHERE b.session_id = ?`,
            ).bind(sessionId),
        ]
        : [
            db.prepare(`SELECT COUNT(*) AS n FROM bills`),
            db.prepare(`SELECT COUNT(*) AS n FROM roll_calls`),
            db.prepare(`SELECT COUNT(*) AS n FROM votes`),
            db.prepare(`SELECT COUNT(*) AS n FROM legislators WHERE active = 1`),
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

app.get('/api/legislators', async (c) => {
    const db = c.env.la_vote_tracker;
    const { chamber, party, q, active, session_id } = c.req.query();
    const sessionId = Number(session_id) || null;

    const where: string[] = [];
    const binds: (string | number)[] = [];
    if (chamber === 'H' || chamber === 'S') {
        where.push('l.role = ?');
        binds.push(chamber === 'S' ? 'Sen' : 'Rep');
    }
    if (party) {
        where.push('l.party = ?');
        binds.push(party.toUpperCase());
    }
    // The "active" flag only makes sense without a session filter — within a session,
    // "served then" is the meaningful predicate, derived from votes below.
    if (!sessionId && (active === '1' || active === '0')) {
        where.push('l.active = ?');
        binds.push(Number(active));
    }
    if (q) {
        where.push('(l.last_name LIKE ? OR l.first_name LIKE ? OR l.nickname LIKE ?)');
        const like = `%${q}%`;
        binds.push(like, like, like);
    }

    // When scoped to a session, restrict to legislators who actually cast at least one
    // vote in that session (covers turnover honestly + picks up synthetic rows).
    const sessionJoin = sessionId
        ? `INNER JOIN (
                SELECT DISTINCT v.people_id
                FROM votes v
                JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
                JOIN bills b       ON b.bill_id      = rc.bill_id
                WHERE b.session_id = ?
           ) sv ON sv.people_id = l.people_id`
        : '';
    if (sessionId) binds.unshift(sessionId);

    const sql = `
        SELECT l.people_id, l.first_name, l.middle_name, l.last_name, l.suffix, l.nickname,
               l.party, l.role, l.district, l.active, l.source, l.term_source,
               l.term_start, l.term_end
        FROM legislators l
        ${sessionJoin}
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY l.last_name, l.first_name
    `;
    const { results } = await db.prepare(sql).bind(...binds).all();
    c.header('cache-control', CACHE);
    return c.json({ legislators: results });
});

app.get('/api/legislators/:id', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);
    const sessionId = Number(c.req.query('session_id')) || null;

    // Scope tallies + party-line to the requested session when provided. The bill join
    // is what carries session_id, so it gets added wherever roll_calls is involved.
    const sessionClause = sessionId ? 'AND b.session_id = ?' : '';
    const sessionBindsFor = (base: (string | number)[]) => (sessionId ? [...base, sessionId] : base);

    const [profile, tally, partyLine] = await db.batch([
        db.prepare(
            `SELECT people_id, first_name, middle_name, last_name, suffix, nickname,
                    party, role, district, active, source, term_source,
                    term_start, term_end, year_elected
             FROM legislators WHERE people_id = ?`,
        ).bind(id),
        db.prepare(
            `SELECT vote, COUNT(*) AS n
             FROM votes v
             JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
             JOIN bills b       ON b.bill_id      = rc.bill_id
             WHERE v.people_id = ? AND rc.vote_category = 'final_passage' ${sessionClause}
             GROUP BY vote`,
        ).bind(...sessionBindsFor([id])),
        // For each roll call, % of same-party members who took the same position.
        // Used to surface "party-line" tendency in the summary card.
        db.prepare(
            `WITH legi AS (
                SELECT party, role FROM legislators WHERE people_id = ?
             ),
             same_party_votes AS (
                SELECT v.roll_call_id, v.vote, v2.vote AS other_vote
                FROM votes v
                JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
                JOIN bills b       ON b.bill_id      = rc.bill_id
                JOIN votes v2 ON v2.roll_call_id = v.roll_call_id AND v2.people_id != v.people_id
                JOIN legislators l2 ON l2.people_id = v2.people_id
                JOIN legi ON legi.party = l2.party AND legi.role = l2.role
                WHERE v.people_id = ? AND rc.vote_category = 'final_passage'
                  AND v.vote IN (1, 2) ${sessionClause}
             )
             SELECT
                COUNT(*) FILTER (WHERE vote = other_vote) AS aligned,
                COUNT(*) AS total
             FROM same_party_votes`,
        ).bind(...sessionBindsFor([id, id])),
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
    });
});

app.get('/api/legislators/:id/votes', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);

    const {
        session_id, chamber, category, passed, close, from, to, q, vote,
        limit: limitStr, offset: offsetStr,
    } = c.req.query();

    // Binds are appended in two clusters: (a) the ? for the legislator join, then (b) WHERE filters.
    // Keep the JOIN bind first so the ordering can't drift if filters reshape.
    const binds: (string | number)[] = [id];
    const where: string[] = [];
    if (session_id) {
        where.push('b.session_id = ?');
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
            rc.roll_call_id, rc.date, rc.chamber, rc.description, rc.vote_category,
            rc.yea, rc.nay, rc.nv, rc.absent, rc.total, rc.passed, rc.margin,
            rc.pdf_doc_id,
            b.bill_id, b.bill_number, b.title,
            v.vote AS cast_vote
        FROM votes v
        JOIN roll_calls rc ON rc.roll_call_id = v.roll_call_id
        JOIN bills b       ON b.bill_id      = rc.bill_id
        WHERE v.people_id = ?
        ${where.length > 0 ? 'AND ' + where.join(' AND ') : ''}
        ORDER BY rc.date DESC, rc.roll_call_id DESC
        LIMIT ? OFFSET ?
    `;
    const { results } = await db.prepare(sql).bind(...binds).all();
    c.header('cache-control', CACHE);
    return c.json({ votes: results, limit, offset });
});

app.get('/api/rollcalls/:id', async (c) => {
    const db = c.env.la_vote_tracker;
    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);

    const [head, members] = await db.batch([
        db.prepare(
            `SELECT rc.*, b.bill_number, b.title, s.name AS session_name
             FROM roll_calls rc
             JOIN bills b      ON b.bill_id      = rc.bill_id
             JOIN sessions s   ON s.session_id   = b.session_id
             WHERE rc.roll_call_id = ?`,
        ).bind(id),
        db.prepare(
            `SELECT v.vote, l.people_id, l.first_name, l.last_name, l.suffix, l.nickname,
                    l.party, l.role, l.district, l.source
             FROM votes v JOIN legislators l ON l.people_id = v.people_id
             WHERE v.roll_call_id = ?
             ORDER BY l.last_name, l.first_name`,
        ).bind(id),
    ]);

    if (head.results.length === 0) return c.json({ error: 'not found' }, 404);
    c.header('cache-control', CACHE);
    return c.json({ roll_call: head.results[0], members: members.results });
});

export default app;
