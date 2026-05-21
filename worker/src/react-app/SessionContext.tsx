import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from './types';

type Ctx = {
    sessions: Session[];
    current: Session | null;
    setCurrent: (s: Session) => void;
};

const SessionCtx = createContext<Ctx | null>(null);
const STORAGE_KEY = 'rollcallla.session_id';

export function SessionProvider({ children }: { children: ReactNode }) {
    const [sessions, setSessions] = useState<Session[]>([]);
    const [current, setCurrentState] = useState<Session | null>(null);

    useEffect(() => {
        fetch('/api/sessions')
            .then((r) => r.json() as Promise<{ sessions: Session[] }>)
            .then((d) => {
                setSessions(d.sessions);
                const saved = Number(localStorage.getItem(STORAGE_KEY));
                const hit = d.sessions.find((s) => s.id === saved);
                // Default to the newest session if nothing valid is remembered.
                setCurrentState(hit ?? d.sessions[0] ?? null);
            });
    }, []);

    const setCurrent = (s: Session) => {
        localStorage.setItem(STORAGE_KEY, String(s.id));
        setCurrentState(s);
    };

    return <SessionCtx.Provider value={{ sessions, current, setCurrent }}>{children}</SessionCtx.Provider>;
}

export function useSession() {
    const ctx = useContext(SessionCtx);
    if (!ctx) throw new Error('useSession outside provider');
    return ctx;
}
