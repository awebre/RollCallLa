import { useSession } from '../SessionContext';
import { formatSessionName } from '../types';

export function SessionPicker() {
    const { sessions, current, setCurrent } = useSession();
    if (sessions.length === 0) return null;
    return (
        <label style={{ display: 'inline-flex', alignItems: 'center', gap: '0.5rem', fontSize: '0.85rem', color: 'var(--app-text-mid)' }}>
            <span style={{ fontFamily: 'Georgia, serif' }}>Session:</span>
            <select
                value={current?.session_id ?? ''}
                onChange={(e) => {
                    const next = sessions.find((s) => s.session_id === Number(e.target.value));
                    if (next) setCurrent(next);
                }}
                style={{
                    padding: '0.3rem 0.5rem',
                    fontFamily: 'Georgia, serif',
                    fontSize: '0.9rem',
                    border: '1px solid var(--app-border-input)',
                    background: 'var(--app-surface)',
                    color: 'var(--app-ink)',
                }}
            >
                {sessions.map((s) => (
                    <option key={s.session_id} value={s.session_id}>
                        {formatSessionName(s.name, s.year_start)}
                    </option>
                ))}
            </select>
        </label>
    );
}
