import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';

export type SessionRow = {
    session_id: number;
    name: string;
    year_start: number;
    year_end: number;
    special: number;
    map_vintage: string;
};

type Ctx = {
    sessions: SessionRow[];
    current: SessionRow | null;
    setCurrent: (s: SessionRow) => void;
};

const SessionCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = 'rollcallla.session_id';

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<SessionRow[]>([]);
    const [current, setCurrentState] = useState<SessionRow | null>(null);

    useEffect(() => {
        fetch('/api/sessions')
            .then((r) => r.json() as Promise<{ sessions: SessionRow[] }>)
            .then((d) => {
                setSessions(d.sessions);
                const saved = Number(localStorage.getItem(STORAGE_KEY));
                const hit = d.sessions.find((s) => s.session_id === saved);
                // Default to the newest session if nothing valid is remembered.
                setCurrentState(hit ?? d.sessions[0] ?? null);
            });
    }, []);

    const setCurrent = (s: SessionRow) => {
        localStorage.setItem(STORAGE_KEY, String(s.session_id));
        setCurrentState(s);
    };

    return <SessionCtx.Provider value={{ sessions, current, setCurrent }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
    const ctx = useContext(SessionCtx);
    if (!ctx) throw new Error('useSession outside provider');
    return ctx;
}
