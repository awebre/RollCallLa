import { Hono } from 'hono';

const app = new Hono<{ Bindings: Env }>();

app.get('/api/', (c) => c.json({ name: 'Cloudflare' }));

app.get('/api/legislators', async (c) => {
    const { chamber, party, q, active } = c.req.query();
    const where: string[] = [];
    const binds: (string | number)[] = [];
    if (chamber === 'H' || chamber === 'S') {
        where.push('role = ?');
        binds.push(chamber === 'S' ? 'Sen' : 'Rep');
    }
    if (party) {
        where.push('party = ?');
        binds.push(party.toUpperCase());
    }
    if (active === '1' || active === '0') {
        where.push('active = ?');
        binds.push(Number(active));
    }
    if (q) {
        where.push('(last_name LIKE ? OR first_name LIKE ? OR nickname LIKE ?)');
        const like = `%${q}%`;
        binds.push(like, like, like);
    }
    const sql = `
        SELECT people_id, first_name, middle_name, last_name, suffix, nickname,
               party, role, district, active
        FROM legislators
        ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
        ORDER BY last_name, first_name
    `;
    const { results } = await c.env.DB.prepare(sql).bind(...binds).all();
    return c.json({ legislators: results });
});

export default app;
