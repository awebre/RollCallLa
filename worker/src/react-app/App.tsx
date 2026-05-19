import { useEffect, useState } from 'react';
import { Roster } from './views/Roster';
import { LegislatorDetail } from './views/LegislatorDetail';
import { RollCallDetail } from './views/RollCallDetail';
import { DistrictMap } from './views/Map';
import { Status } from './components/Status';
import { SessionPicker } from './components/SessionPicker';
import { SessionProvider, useSession } from './SessionContext';

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

function GeoPrefetch() {
    const { current } = useSession();
    useEffect(() => {
        const v = current?.map_vintage;
        if (!v) return;
        fetch(`/geo/${v}/house.json`);
        fetch(`/geo/${v}/senate.json`);
        fetch(`/geo/${v}/zip-districts.json`);
    }, [current?.map_vintage]);
    return null;
}

function App() {
    const { path, param } = useHashRoute();
    return (
        <SessionProvider>
            <GeoPrefetch />
            <main className="box-border mx-auto w-full max-w-260 px-4 pt-8 pb-16 font-serif text-(--app-ink)">
                <header className="mb-3 border-b-2 border-(--app-ink) pb-2">
                    <div className="flex flex-wrap items-end justify-between gap-4">
                        <a href="#/" className="text-left no-underline text-inherit">
                            <h1 className="m-0 text-4xl leading-none tracking-[-0.02em]">
                                Roll Call LA
                            </h1>
                            <p className="mt-[0.2rem] mb-0 text-[0.9rem] tracking-[0.01em] text-(--app-subtitle) italic">
                                Louisiana Legislator Vote Tracker
                            </p>
                        </a>
                        <SessionPicker />
                    </div>
                    <Status />
                </header>
                <nav className="mb-5 flex gap-5 text-[0.95rem]">
                    <a href="#/" className={navLinkClass(path === 'roster')}>Roster</a>
                    <a href="#/map" className={navLinkClass(path === 'map')}>District Map</a>
                </nav>

                {path === 'roster' && <Roster />}
                {path === 'map' && <DistrictMap />}
                {path === 'legislator' && param && <LegislatorDetail id={Number(param)} />}
                {path === 'rollcall' && param && <RollCallDetail id={Number(param)} />}
            </main>
        </SessionProvider>
    );
}

function navLinkClass(active: boolean): string {
    return `border-b-2 pb-[0.15rem] no-underline ${active ? 'border-(--app-ink) text-(--app-ink) font-semibold' : 'border-transparent text-(--app-subtitle) font-medium'}`;
}

export default App;
