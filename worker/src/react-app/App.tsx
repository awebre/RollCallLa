import { useEffect, useState, type CSSProperties } from 'react';
import { Roster } from './views/Roster';
import { LegislatorDetail } from './views/LegislatorDetail';
import { RollCallDetail } from './views/RollCallDetail';
import { DistrictMap } from './views/Map';
import { Status } from './components/Status';
import { SessionPicker } from './components/SessionPicker';
import { SessionProvider } from './SessionContext';

// Tiny hash router so we avoid a routing dependency for v1.
// Paths: '/', '/map', '/legislator/<id>', '/rollcall/<id>'
function useHashRoute(): { path: string; param: string | null } {
    const [hash, setHash] = useState(window.location.hash || '#/');
    useEffect(() => {
        const onHash = () => setHash(window.location.hash || '#/');
        window.addEventListener('hashchange', onHash);
        return () => window.removeEventListener('hashchange', onHash);
    }, []);
    const route = hash.replace(/^#/, '');
    if (route === '/map') return { path: 'map', param: null };
    const legMatch = route.match(/^\/legislator\/(\d+)$/);
    if (legMatch) return { path: 'legislator', param: legMatch[1] };
    const rcMatch = route.match(/^\/rollcall\/(\d+)$/);
    if (rcMatch) return { path: 'rollcall', param: rcMatch[1] };
    return { path: 'roster', param: null };
}

function App() {
    const { path, param } = useHashRoute();
    return (
        <SessionProvider>
            <main
                style={{
                    maxWidth: 1040,
                    margin: '0 auto',
                    padding: '2rem 1rem 4rem',
                    fontFamily: 'Georgia, "Times New Roman", serif',
                    color: '#1a1a1a',
                }}
            >
                <header style={{ borderBottom: '2px solid #1a1a1a', paddingBottom: '0.5rem', marginBottom: '0.75rem' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end', gap: '1rem', flexWrap: 'wrap' }}>
                        <a href="#/" style={{ color: 'inherit', textDecoration: 'none', textAlign: 'left' }}>
                            <h1 style={{ margin: 0, fontSize: '2.25rem', letterSpacing: '-0.02em', lineHeight: 1 }}>
                                Roll Call LA
                            </h1>
                            <p style={{ margin: '0.2rem 0 0', fontSize: '0.9rem', color: '#5a6b80', fontStyle: 'italic', letterSpacing: '0.01em' }}>
                                Louisiana Legislator Vote Tracker
                            </p>
                        </a>
                        <SessionPicker />
                    </div>
                    <Status />
                </header>
                <nav style={{ display: 'flex', gap: '1.25rem', marginBottom: '1.25rem', fontSize: '0.95rem' }}>
                    <a href="#/" style={navLinkStyle(path === 'roster')}>Roster</a>
                    <a href="#/map" style={navLinkStyle(path === 'map')}>District Map</a>
                </nav>

                {path === 'roster' && <Roster />}
                {path === 'map' && <DistrictMap />}
                {path === 'legislator' && param && <LegislatorDetail id={Number(param)} />}
                {path === 'rollcall' && param && <RollCallDetail id={Number(param)} />}
            </main>
        </SessionProvider>
    );
}

function navLinkStyle(active: boolean): CSSProperties {
    return {
        color: active ? '#1a1a1a' : '#5a6b80',
        textDecoration: 'none',
        borderBottom: active ? '2px solid #1a1a1a' : '2px solid transparent',
        paddingBottom: '0.15rem',
        fontWeight: active ? 600 : 500,
    };
}

export default App;
