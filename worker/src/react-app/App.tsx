import { useEffect } from 'react';
import { Switch, Route, Link, useLocation } from 'wouter';
import { Roster } from './views/Roster';
import { LegislatorDetail } from './views/LegislatorDetail';
import { RollCallDetail } from './views/RollCallDetail';
import { DistrictMap } from './views/Map';
import { AdminView } from './views/Admin';
import { Status } from './components/Status';
import { SessionPicker } from './components/SessionPicker';
import { SessionProvider, useSession } from './SessionContext';
import { FeedbackProvider, useFeedback } from './FeedbackContext';

const GEO_BASE = import.meta.env.VITE_GEO_BASE_URL ?? '/geo';

function GeoPrefetch() {
    const { current } = useSession();
    useEffect(() => {
        const v = current?.map_vintage;
        if (!v) return;
        fetch(`${GEO_BASE}/${v}/house.json`);
        fetch(`${GEO_BASE}/${v}/senate.json`);
        fetch(`${GEO_BASE}/${v}/zip-districts.json`);
    }, [current?.map_vintage]);
    return null;
}

function Shell() {
    const [location] = useLocation();
    const path = location.split('/')[1] ?? '';

    return (
        <SessionProvider>
            <FeedbackProvider>
                <GeoPrefetch />
                <main className="box-border mx-auto w-full max-w-260 px-4 pt-8 pb-16 font-serif text-(--app-ink)">
                    <header className="mb-3 border-b-2 border-(--app-ink) pb-2">
                        <div className="flex flex-wrap items-end justify-between gap-4">
                            <Link href="/" className="text-left no-underline text-inherit">
                                <h1 className="m-0 text-4xl leading-none tracking-[-0.02em]">
                                    Roll Call LA
                                </h1>
                                <p className="mt-[0.2rem] mb-0 text-[0.9rem] tracking-[0.01em] text-(--app-subtitle) italic">
                                    Louisiana Legislator Vote Tracker
                                </p>
                            </Link>
                            <SessionPicker />
                        </div>
                        <Status />
                    </header>
                    <nav className="mb-5 flex gap-5 text-[0.95rem]">
                        <Link href="/" className={navLinkClass(path === '')}>Roster</Link>
                        <Link href="/map" className={navLinkClass(path === 'map')}>District Map</Link>
                    </nav>

                    <Switch>
                        <Route path="/" component={Roster} />
                        <Route path="/map" component={DistrictMap} />
                        <Route path="/legislator/:id">
                            {(params) => <LegislatorDetail id={Number(params.id)} />}
                        </Route>
                        <Route path="/rollcall/:id">
                            {(params) => <RollCallDetail id={Number(params.id)} />}
                        </Route>
                        <Route component={Roster} />
                    </Switch>
                </main>
                <footer className="box-border mx-auto w-full max-w-260 px-4 pb-8 font-serif text-(--app-subtitle) text-sm border-t border-(--app-ink)/20 pt-4">
                    <FooterFeedback />
                </footer>
            </FeedbackProvider>
        </SessionProvider>
    );
}

function App() {
    return (
        <Switch>
            <Route path="/admin">
                <main className="box-border mx-auto w-full max-w-200 px-4 pt-8 pb-16 font-serif text-(--app-ink)">
                    <AdminView />
                </main>
            </Route>
            <Route>
                <Shell />
            </Route>
        </Switch>
    );
}

function FooterFeedback() {
    const { openFeedback } = useFeedback();
    return (
        <span>
            See incorrect data?{' '}
            <button
                onClick={() => openFeedback()}
                className="underline cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit italic"
            >
                Report an issue.
            </button>
        </span>
    );
}

function navLinkClass(active: boolean): string {
    return `border-b-2 pb-[0.15rem] no-underline ${active ? 'border-(--app-ink) text-(--app-ink) font-semibold' : 'border-transparent text-(--app-subtitle) font-medium'}`;
}

export default App;
