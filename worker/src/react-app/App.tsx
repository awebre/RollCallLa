import { useEffect, useState } from 'react';
import { Roster } from './views/Roster';
import { LegislatorDetail } from './views/LegislatorDetail';
import { RollCallDetail } from './views/RollCallDetail';
import { Status } from './components/Status';

// Tiny hash router so we avoid a routing dependency for v1.
// Paths: '/', '/legislator/<id>', '/rollcall/<id>'
function useHashRoute(): { path: string; param: string | null } {
    const [hash, setHash] = useState(window.location.hash || '#/');
    useEffect(() => {
        const onHash = () => setHash(window.location.hash || '#/');
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const route = hash.replace(/^#/, '');
    const legMatch = route.match(/^\/legislator\/(\d+)$/);
    if (legMatch) return { path: 'legislator', param: legMatch[1] };
    const rcMatch = route.match(/^\/rollcall\/(\d+)$/);
    if (rcMatch) return { path: 'rollcall', param: rcMatch[1] };
    return { path: 'roster', param: null };
}

function App() {
    const { path, param } = useHashRoute();
    return (
        <main
            style={{
                maxWidth: 1040,
                margin: '0 auto',
                padding: '2rem 1rem 4rem',
                fontFamily: 'Georgia, "Times New Roman", serif',
                color: '#1a1a1a',
            }}
        >
            <header style={{ borderBottom: '2px solid #1a1a1a', paddingBottom: '0.5rem', marginBottom: '1.25rem' }}>
                <a href="#/" style={{ color: 'inherit', textDecoration: 'none' }}>
                    <h1 style={{ margin: 0, fontSize: '2rem', letterSpacing: '-0.01em' }}>
                        Louisiana Legislator Vote Tracker
                    </h1>
                </a>
                <Status />
            </header>

            {path === 'roster' && <Roster />}
            {path === 'legislator' && param && <LegislatorDetail id={Number(param)} />}
            {path === 'rollcall' && param && <RollCallDetail id={Number(param)} />}
        </main>
    );
}

export default App;
