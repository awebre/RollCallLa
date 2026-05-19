import { useEffect, useRef, useState } from 'react';
import type { FeedbackCategory } from '../FeedbackContext';
import { CATEGORY_LABELS } from '../FeedbackContext';

const CATEGORIES: FeedbackCategory[] = ['representative', 'vote', 'bill', 'map'];
const SITEKEY = import.meta.env.VITE_TURNSTILE_SITEKEY ?? '0x4AAAAAADSkChqMyzEbU6Vb';

export function FeedbackModal({
    initialCategory,
    onClose,
}: {
    initialCategory?: FeedbackCategory;
    onClose: () => void;
}) {
    const [step, setStep] = useState<1 | 2>(initialCategory !== undefined ? 2 : 1);
    const [category, setCategory] = useState<FeedbackCategory | undefined>(initialCategory);
    const [description, setDescription] = useState('');
    const [reporterEmail, setReporterEmail] = useState('');
    const [token, setToken] = useState<string | null>(null);
    const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle');
    const widgetRef = useRef<HTMLDivElement>(null);
    const widgetIdRef = useRef<string | null>(null);

    // Prevent body scroll while open
    useEffect(() => {
        document.body.style.overflow = 'hidden';
        return () => { document.body.style.overflow = ''; };
    }, []);

    // ESC to close
    useEffect(() => {
        const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
        document.addEventListener('keydown', handler);
        return () => document.removeEventListener('keydown', handler);
    }, [onClose]);

    // Render Turnstile widget when reaching step 2
    useEffect(() => {
        if (step !== 2 || !widgetRef.current || !window.turnstile) return;
        widgetIdRef.current = window.turnstile.render(widgetRef.current, {
            sitekey: SITEKEY,
            callback: (t) => setToken(t),
            'expired-callback': () => setToken(null),
            'error-callback': () => setToken(null),
        });
        return () => {
            if (widgetIdRef.current) window.turnstile?.remove(widgetIdRef.current);
            widgetIdRef.current = null;
        };
    }, [step]);

    async function submit() {
        if (!category || !description.trim() || !token) return;
        setStatus('submitting');
        try {
            const res = await fetch('/api/feedback', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    category,
                    description: description.trim(),
                    email: reporterEmail.trim() || null,
                    turnstileToken: token,
                }),
            });
            if (!res.ok) throw new Error();
            setStatus('done');
        } catch {
            setStatus('error');
            if (widgetIdRef.current) window.turnstile?.reset(widgetIdRef.current);
            setToken(null);
        }
    }

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/40"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div className="relative bg-(--app-bg) border-2 border-(--app-ink) w-full max-w-md mx-4 p-6 font-serif text-(--app-ink)">
                <button
                    onClick={onClose}
                    className="absolute top-3 right-4 text-xl leading-none text-(--app-subtitle) hover:text-(--app-ink) cursor-pointer bg-transparent border-none"
                    aria-label="Close"
                >
                    ×
                </button>

                {status === 'done' ? (
                    <div className="text-center py-4">
                        <p className="text-lg font-semibold mb-2">Thanks for the report.</p>
                        <p className="text-(--app-subtitle) text-sm mb-5">We'll look into it.</p>
                        <button onClick={onClose} className="underline text-sm cursor-pointer bg-transparent border-none font-inherit text-inherit">
                            Close
                        </button>
                    </div>
                ) : step === 1 ? (
                    <>
                        <h2 className="text-lg font-semibold mb-1">Report a data issue</h2>
                        <p className="text-(--app-subtitle) text-sm mb-4">What kind of data did you find an error in?</p>
                        <div className="grid grid-cols-2 gap-3">
                            {CATEGORIES.map((c) => (
                                <button
                                    key={c}
                                    onClick={() => { setCategory(c); setStep(2); }}
                                    className="border border-(--app-ink) py-3 px-4 text-sm text-left hover:bg-(--app-ink) hover:text-(--app-bg) transition-colors cursor-pointer bg-transparent font-inherit"
                                >
                                    {CATEGORY_LABELS[c]}
                                </button>
                            ))}
                        </div>
                    </>
                ) : (
                    <>
                        <div className="flex items-center gap-2 mb-4">
                            <button
                                onClick={() => setStep(1)}
                                className="text-(--app-subtitle) text-sm underline cursor-pointer bg-transparent border-none font-inherit"
                            >
                                ← Back
                            </button>
                            <span className="text-sm font-semibold">{CATEGORY_LABELS[category!]}</span>
                        </div>

                        <label className="block text-sm font-semibold mb-1">
                            Describe the issue <span className="text-(--app-subtitle) font-normal">(required)</span>
                        </label>
                        <textarea
                            className="w-full border border-(--app-ink) p-2 text-sm font-serif bg-(--app-bg) text-(--app-ink) resize-y min-h-24 mb-4"
                            value={description}
                            onChange={(e) => setDescription(e.target.value)}
                            placeholder="e.g. Rep. Smith's vote on HB 123 shows Yea but the official record shows Nay."
                        />

                        <label className="block text-sm font-semibold mb-1">
                            Your email <span className="text-(--app-subtitle) font-normal">(optional — so we can follow up)</span>
                        </label>
                        <input
                            type="email"
                            className="w-full border border-(--app-ink) p-2 text-sm font-serif bg-(--app-bg) text-(--app-ink) mb-4"
                            value={reporterEmail}
                            onChange={(e) => setReporterEmail(e.target.value)}
                            placeholder="you@example.com"
                        />

                        <div ref={widgetRef} className="mb-4" />

                        {status === 'error' && (
                            <p className="text-sm text-red-600 mb-3">Something went wrong. Please try again.</p>
                        )}

                        <button
                            onClick={submit}
                            disabled={!description.trim() || !token || status === 'submitting'}
                            className="w-full border border-(--app-ink) py-2 text-sm font-semibold cursor-pointer bg-transparent font-inherit text-(--app-ink) hover:bg-(--app-ink) hover:text-(--app-bg) transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                        >
                            {status === 'submitting' ? 'Submitting…' : 'Submit report'}
                        </button>
                    </>
                )}
            </div>
        </div>
    );
}
