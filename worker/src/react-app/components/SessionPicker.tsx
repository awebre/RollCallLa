import { useSession } from '../SessionContext';

export function SessionPicker() {
    const { sessions, current, setCurrent } = useSession();
    if (sessions.length === 0) return null;
    return (
        <select
            value={current?.session_id ?? ''}
            onChange={(e) => {
                const next = sessions.find((s) => s.session_id === Number(e.target.value));
                if (next) setCurrent(next);
            }}
            style={{
                padding: '0.3rem 0.5rem',
                fontFamily: 'ui-monospace, monospace',
                fontSize: '0.85rem',
                border: '1px solid #bbb',
                background: '#fafaf6',
            }}
            aria-label="Session"
        >
            {sessions.map((s) => (
                <option key={s.session_id} value={s.session_id}>
                    {s.name}
                </option>
            ))}
        </select>
    );
}
