import { useEffect, useState } from 'react';
import { startRegistration, startAuthentication } from '@simplewebauthn/browser';

type AdminState = 'loading' | 'setup' | 'login' | 'dashboard';

type FeedbackRow = {
    id: number;
    category: string;
    description: string;
    email: string | null;
    status: string;
    created_at: string;
    updated_at: string;
};

const STATUS_LABELS: Record<string, string> = {
    new: 'New',
    in_progress: 'In Progress',
    addressed: 'Addressed',
    dismissed: 'Dismissed',
};

const STATUS_COLORS: Record<string, string> = {
    new: 'text-blue-700 bg-blue-50 border-blue-200',
    in_progress: 'text-amber-700 bg-amber-50 border-amber-200',
    addressed: 'text-green-700 bg-green-50 border-green-200',
    dismissed: 'text-gray-500 bg-gray-50 border-gray-200',
};

export function AdminView() {
    const [state, setState] = useState<AdminState>('loading');
    const [setupToken, setSetupToken] = useState('');
    const [feedback, setFeedback] = useState<FeedbackRow[]>([]);
    const [statusFilter, setStatusFilter] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        fetch('/api/admin/me')
            .then((r) => r.json<{ authenticated: boolean; credential_exists: boolean }>())
            .then((data) => {
                if (data.authenticated) {
                    setState('dashboard');
                    loadFeedback('');
                } else if (data.credential_exists) {
                    setState('login');
                } else {
                    setState('setup');
                }
            })
            .catch(() => setState('login'));
    }, []);

    async function loadFeedback(filter: string) {
        const qs = filter ? `?status=${filter}` : '';
        const data = await fetch(`/api/admin/feedback${qs}`).then((r) =>
            r.json<{ feedback: FeedbackRow[] }>(),
        );
        setFeedback(data.feedback);
    }

    async function handleSetup() {
        setError(null);
        setBusy(true);
        try {

            const opts = await fetch('/api/admin/setup/challenge', {
                method: 'POST',
                headers: { 'X-Admin-Setup-Token': setupToken },
            }).then((r) => {
                if (!r.ok) throw new Error('Invalid setup token or already registered');
                return r.json();
            });

            const credential = await startRegistration({ optionsJSON: opts });

            const res = await fetch('/api/admin/setup/verify', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'X-Admin-Setup-Token': setupToken,
                },
                body: JSON.stringify(credential),
            });
            if (!res.ok) throw new Error('Passkey registration failed');

            setState('login');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Setup failed';
            setError(
                msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('not allowed')
                    ? 'Cancelled. If 1Password intercepted, dismiss it and click Register again — the browser will use Touch ID directly.'
                    : msg,
            );
        } finally {
            setBusy(false);
        }
    }

    async function handleLogin() {
        setError(null);
        setBusy(true);
        try {
            const opts = await fetch('/api/admin/auth/challenge', { method: 'POST' }).then((r) => {
                if (!r.ok) throw new Error('No passkey registered');
                return r.json();
            });

            const assertion = await startAuthentication({ optionsJSON: opts });

            const res = await fetch('/api/admin/auth/verify', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(assertion),
            });
            if (!res.ok) throw new Error('Authentication failed');

            setState('dashboard');
            loadFeedback('');
        } catch (e) {
            const msg = e instanceof Error ? e.message : 'Login failed';
            setError(
                msg.toLowerCase().includes('cancel') || msg.toLowerCase().includes('not allowed')
                    ? 'Cancelled. Click Sign in again to retry.'
                    : msg,
            );
        } finally {
            setBusy(false);
        }
    }

    async function handleLogout() {
        await fetch('/api/admin/logout', { method: 'POST' });
        setState('login');
        setFeedback([]);
    }

    async function setStatus(id: number, status: string) {
        await fetch(`/api/admin/feedback/${id}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ status }),
        });
        setFeedback((rows) => rows.map((r) => (r.id === id ? { ...r, status } : r)));
    }

    async function applyFilter(filter: string) {
        setStatusFilter(filter);
        await loadFeedback(filter);
    }

    if (state === 'loading') {
        return <div className="pt-16 text-center text-(--app-subtitle) italic">Loading…</div>;
    }

    if (state === 'setup') {
        return (
            <div className="max-w-sm mx-auto pt-16">
                <h2 className="text-2xl font-semibold mb-6">Register Admin Passkey</h2>
                <p className="text-sm text-(--app-subtitle) mb-4">
                    Enter your setup token, then follow the passkey prompt. This can only be done once.
                </p>
                <label className="block mb-1 text-sm font-medium">Setup token</label>
                <input
                    type="password"
                    value={setupToken}
                    onChange={(e) => setSetupToken(e.target.value)}
                    className="w-full border border-(--app-ink)/30 rounded px-3 py-2 mb-4 text-sm font-mono bg-(--app-bg)"
                    placeholder="ADMIN_SETUP_TOKEN value"
                />
                {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
                <button
                    onClick={handleSetup}
                    disabled={busy || !setupToken}
                    className="w-full py-2 rounded bg-(--app-ink) text-(--app-bg) font-medium disabled:opacity-40"
                >
                    {busy ? 'Registering…' : 'Register passkey'}
                </button>
            </div>
        );
    }

    if (state === 'login') {
        return (
            <div className="max-w-sm mx-auto pt-16 text-center">
                <h2 className="text-2xl font-semibold mb-6">Admin</h2>
                {error && <p className="text-red-600 text-sm mb-3">{error}</p>}
                <button
                    onClick={handleLogin}
                    disabled={busy}
                    className="w-full py-2 rounded bg-(--app-ink) text-(--app-bg) font-medium disabled:opacity-40"
                >
                    {busy ? 'Signing in…' : 'Sign in with passkey'}
                </button>
            </div>
        );
    }

    return (
        <div>
            <div className="flex items-center justify-between mb-6">
                <h2 className="text-2xl font-semibold">Feedback</h2>
                <button
                    onClick={handleLogout}
                    className="text-sm text-(--app-subtitle) underline"
                >
                    Log out
                </button>
            </div>

            <div className="flex gap-2 mb-5 flex-wrap">
                {['', 'new', 'in_progress', 'addressed', 'dismissed'].map((s) => (
                    <button
                        key={s}
                        onClick={() => applyFilter(s)}
                        className={`px-3 py-1 rounded-full border text-sm ${
                            statusFilter === s
                                ? 'bg-(--app-ink) text-(--app-bg) border-(--app-ink)'
                                : 'border-(--app-ink)/30 text-(--app-subtitle)'
                        }`}
                    >
                        {s ? STATUS_LABELS[s] : 'All'}
                    </button>
                ))}
            </div>

            {feedback.length === 0 ? (
                <p className="text-(--app-subtitle) italic text-sm">No feedback found.</p>
            ) : (
                <div className="flex flex-col gap-3">
                    {feedback.map((row) => (
                        <div
                            key={row.id}
                            className="border border-(--app-ink)/20 rounded-lg p-4 bg-(--app-bg)"
                        >
                            <div className="flex items-start justify-between gap-4 mb-2">
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-xs font-medium uppercase tracking-wide text-(--app-subtitle)">
                                        {row.category}
                                    </span>
                                    <span
                                        className={`text-xs px-2 py-0.5 rounded-full border ${STATUS_COLORS[row.status] ?? ''}`}
                                    >
                                        {STATUS_LABELS[row.status] ?? row.status}
                                    </span>
                                </div>
                                <span className="text-xs text-(--app-subtitle) whitespace-nowrap">
                                    {new Date(row.created_at + 'Z').toLocaleDateString()}
                                </span>
                            </div>

                            <p className="text-sm mb-3 whitespace-pre-wrap">{row.description}</p>

                            {row.email && (
                                <p className="text-xs text-(--app-subtitle) mb-3">
                                    From: <a href={`mailto:${row.email}`} className="underline">{row.email}</a>
                                </p>
                            )}

                            <div className="flex gap-2 flex-wrap">
                                {Object.keys(STATUS_LABELS)
                                    .filter((s) => s !== row.status)
                                    .map((s) => (
                                        <button
                                            key={s}
                                            onClick={() => setStatus(row.id, s)}
                                            className="text-xs px-2 py-1 rounded border border-(--app-ink)/30 text-(--app-subtitle) hover:border-(--app-ink) hover:text-(--app-ink)"
                                        >
                                            → {STATUS_LABELS[s]}
                                        </button>
                                    ))}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}
