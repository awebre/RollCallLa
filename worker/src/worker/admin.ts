import { Hono } from 'hono';
import {
    generateRegistrationOptions,
    verifyRegistrationResponse,
    generateAuthenticationOptions,
    verifyAuthenticationResponse,
} from '@simplewebauthn/server';
import type { RegistrationResponseJSON, AuthenticationResponseJSON } from '@simplewebauthn/types';

type AdminEnv = Env & { SESSION_SECRET: string; ADMIN_SETUP_TOKEN: string };

export const admin = new Hono<{ Bindings: AdminEnv }>();

// ── helpers ──────────────────────────────────────────────────────────────────

function getRpInfo(req: Request): { rpID: string; origin: string } {
    const url = new URL(req.url);
    return {
        rpID: url.hostname,
        origin: `${url.protocol}//${url.host}`,
    };
}

async function sign(payload: string, secret: string): Promise<string> {
    const key = await crypto.subtle.importKey(
        'raw',
        new TextEncoder().encode(secret),
        { name: 'HMAC', hash: 'SHA-256' },
        false,
        ['sign'],
    );
    const sig = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(payload));
    return btoa(String.fromCharCode(...new Uint8Array(sig)));
}

async function makeSessionCookie(secret: string): Promise<string> {
    const exp = Date.now() + 24 * 60 * 60 * 1000;
    const payload = btoa(JSON.stringify({ exp }));
    const sig = await sign(payload, secret);
    const token = `${payload}.${sig}`;
    return `admin_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=86400`;
}

async function verifySessionCookie(token: string, secret: string): Promise<boolean> {
    const dot = token.indexOf('.');
    if (dot === -1) return false;
    const payload = token.slice(0, dot);
    const sig = token.slice(dot + 1);
    const expected = await sign(payload, secret);
    if (expected !== sig) return false;
    try {
        const { exp } = JSON.parse(atob(payload));
        return Date.now() < exp;
    } catch {
        return false;
    }
}

function getSessionToken(req: Request): string | null {
    const cookie = req.headers.get('Cookie') ?? '';
    const match = cookie.match(/(?:^|;\s*)admin_session=([^;]+)/);
    return match ? match[1] : null;
}

async function requireSetupToken(c: { req: { raw: Request }; env: AdminEnv }, next: () => Promise<Response>): Promise<Response> {
    const provided = c.req.raw.headers.get('X-Admin-Setup-Token');
    if (!c.env.ADMIN_SETUP_TOKEN || provided !== c.env.ADMIN_SETUP_TOKEN) {
        return Response.json({ error: 'forbidden' }, { status: 403 });
    }
    return next();
}

async function requireSession(c: { req: { raw: Request }; env: AdminEnv }, next: () => Promise<Response>): Promise<Response> {
    const token = getSessionToken(c.req.raw);
    if (!token || !c.env.SESSION_SECRET) {
        return Response.json({ error: 'unauthorized' }, { status: 401 });
    }
    const ok = await verifySessionCookie(token, c.env.SESSION_SECRET);
    if (!ok) return Response.json({ error: 'unauthorized' }, { status: 401 });
    return next();
}

async function getStoredChallenge(db: D1Database): Promise<string | null> {
    const row = await db.prepare(
        `SELECT challenge FROM admin_challenges WHERE expires_at > datetime('now') ORDER BY id DESC LIMIT 1`,
    ).first<{ challenge: string }>();
    await db.prepare(`DELETE FROM admin_challenges WHERE expires_at <= datetime('now')`).run();
    return row?.challenge ?? null;
}

async function storeChallenge(db: D1Database, challenge: string): Promise<void> {
    await db.prepare(
        `INSERT INTO admin_challenges (challenge, expires_at) VALUES (?, datetime('now', '+5 minutes'))`,
    ).bind(challenge).run();
}

// ── setup (first-time registration) ──────────────────────────────────────────

admin.post('/setup/challenge', async (c) => {
    const authRes = await requireSetupToken(
        { req: { raw: c.req.raw }, env: c.env },
        async () => Response.json({ ok: true }),
    );
    if (!authRes.ok) return authRes;

    const db = c.env.la_vote_tracker;
    const existing = await db.prepare(`SELECT id FROM admin_credentials LIMIT 1`).first();
    if (existing) return c.json({ error: 'already registered' }, 403);

    const { rpID } = getRpInfo(c.req.raw);
    const options = await generateRegistrationOptions({
        rpName: 'Roll Call LA',
        rpID,
        userName: 'admin',
        attestationType: 'none',
        authenticatorSelection: {
            residentKey: 'required',
            userVerification: 'required',
        },
    });

    await storeChallenge(db, options.challenge);
    return c.json(options);
});

admin.post('/setup/verify', async (c) => {
    const authRes = await requireSetupToken(
        { req: { raw: c.req.raw }, env: c.env },
        async () => Response.json({ ok: true }),
    );
    if (!authRes.ok) return authRes;

    const db = c.env.la_vote_tracker;
    const existing = await db.prepare(`SELECT id FROM admin_credentials LIMIT 1`).first();
    if (existing) return c.json({ error: 'already registered' }, 403);

    const challenge = await getStoredChallenge(db);
    if (!challenge) return c.json({ error: 'no pending challenge' }, 400);

    const body = await c.req.json<RegistrationResponseJSON>();
    const { rpID, origin } = getRpInfo(c.req.raw);

    const { verified, registrationInfo } = await verifyRegistrationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        requireUserVerification: true,
    });

    if (!verified || !registrationInfo) return c.json({ error: 'verification failed' }, 400);

    const { credential } = registrationInfo;
    const publicKeyB64 = btoa(String.fromCharCode(...credential.publicKey));

    await db.prepare(
        `INSERT INTO admin_credentials (credential_id, public_key, counter) VALUES (?, ?, ?)`,
    ).bind(credential.id, publicKeyB64, credential.counter).run();

    return c.json({ ok: true });
});

// ── auth ─────────────────────────────────────────────────────────────────────

admin.post('/auth/challenge', async (c) => {
    const db = c.env.la_vote_tracker;
    const cred = await db.prepare(
        `SELECT credential_id FROM admin_credentials LIMIT 1`,
    ).first<{ credential_id: string }>();
    if (!cred) return c.json({ error: 'no credential registered' }, 404);

    const { rpID } = getRpInfo(c.req.raw);
    const options = await generateAuthenticationOptions({
        rpID,
        allowCredentials: [{ id: cred.credential_id }],
        userVerification: 'required',
    });

    await storeChallenge(db, options.challenge);
    return c.json(options);
});

admin.post('/auth/verify', async (c) => {
    const db = c.env.la_vote_tracker;
    const challenge = await getStoredChallenge(db);
    if (!challenge) return c.json({ error: 'no pending challenge' }, 400);

    const cred = await db.prepare(
        `SELECT credential_id, public_key, counter FROM admin_credentials LIMIT 1`,
    ).first<{ credential_id: string; public_key: string; counter: number }>();
    if (!cred) return c.json({ error: 'no credential registered' }, 404);

    const body = await c.req.json<AuthenticationResponseJSON>();
    const { rpID, origin } = getRpInfo(c.req.raw);

    const publicKey = Uint8Array.from(atob(cred.public_key), (ch) => ch.charCodeAt(0));

    const { verified, authenticationInfo } = await verifyAuthenticationResponse({
        response: body,
        expectedChallenge: challenge,
        expectedOrigin: origin,
        expectedRPID: rpID,
        credential: {
            id: cred.credential_id,
            publicKey,
            counter: cred.counter,
        },
        requireUserVerification: true,
    });

    if (!verified) return c.json({ error: 'verification failed' }, 401);

    await db.prepare(`UPDATE admin_credentials SET counter = ? WHERE credential_id = ?`)
        .bind(authenticationInfo!.newCounter, cred.credential_id)
        .run();

    const cookieHeader = await makeSessionCookie(c.env.SESSION_SECRET);
    return new Response(JSON.stringify({ ok: true }), {
        headers: { 'Content-Type': 'application/json', 'Set-Cookie': cookieHeader },
    });
});

// ── session ───────────────────────────────────────────────────────────────────

admin.get('/me', async (c) => {
    const db = c.env.la_vote_tracker;
    const credentialExists = !!(await db.prepare(`SELECT id FROM admin_credentials LIMIT 1`).first());

    const token = getSessionToken(c.req.raw);
    const authenticated = token && c.env.SESSION_SECRET
        ? await verifySessionCookie(token, c.env.SESSION_SECRET)
        : false;

    return c.json({ authenticated, credential_exists: credentialExists });
});

admin.post('/logout', (c) => {
    return new Response(JSON.stringify({ ok: true }), {
        headers: {
            'Content-Type': 'application/json',
            'Set-Cookie': 'admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0',
        },
    });
});

// ── feedback management ───────────────────────────────────────────────────────

const VALID_STATUSES = new Set(['new', 'in_progress', 'addressed', 'dismissed']);

admin.get('/feedback', async (c) => {
    const sessionRes = await requireSession(
        { req: { raw: c.req.raw }, env: c.env },
        async () => Response.json({ ok: true }),
    );
    if (!sessionRes.ok) return sessionRes;

    const db = c.env.la_vote_tracker;
    const status = c.req.query('status');
    const limit = Math.min(Number(c.req.query('limit')) || 50, 200);
    const offset = Math.max(Number(c.req.query('offset')) || 0, 0);

    const where = status && VALID_STATUSES.has(status) ? `WHERE status = '${status}'` : '';
    const { results } = await db.prepare(
        `SELECT id, category, description, email, status, created_at, updated_at
         FROM feedback ${where}
         ORDER BY created_at DESC LIMIT ? OFFSET ?`,
    ).bind(limit, offset).all();

    return c.json({ feedback: results, limit, offset });
});

admin.patch('/feedback/:id', async (c) => {
    const sessionRes = await requireSession(
        { req: { raw: c.req.raw }, env: c.env },
        async () => Response.json({ ok: true }),
    );
    if (!sessionRes.ok) return sessionRes;

    const id = Number(c.req.param('id'));
    if (!Number.isFinite(id)) return c.json({ error: 'bad id' }, 400);

    const { status } = await c.req.json<{ status?: string }>();
    if (!status || !VALID_STATUSES.has(status)) return c.json({ error: 'invalid status' }, 400);

    const db = c.env.la_vote_tracker;
    const result = await db.prepare(
        `UPDATE feedback SET status = ?, updated_at = datetime('now') WHERE id = ?`,
    ).bind(status, id).run();

    if (!result.meta.changes) return c.json({ error: 'not found' }, 404);
    return c.json({ ok: true });
});
