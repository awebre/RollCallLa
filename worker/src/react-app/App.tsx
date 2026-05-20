import { useEffect } from 'react';
import { Switch, Route, Link, Redirect, useLocation, useRoute } from 'wouter';
import { Roster } from './views/Roster';
import { LegislatorDetail } from './views/LegislatorDetail';
import { RollCallDetail } from './views/RollCallDetail';
import { DistrictMap } from './views/Map';
import { AdminView } from './views/Admin';
import { AgendaView } from './views/AgendaView';
import { Status } from './components/Status';
import { SessionPicker } from './components/SessionPicker';
import { SessionProvider, useSession } from './SessionContext';
import { FeedbackProvider, useFeedback } from './FeedbackContext';
import { AdminProvider, useAdmin } from './AdminContext';
import { DebugProvider } from './debug/DebugContext';
import { DebugPanel } from './debug/DebugPanel';

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
                        <MapNavLink />
                        <RosterNavLink />
                        <AgendaNavLink />
                        <AdminNavLink />
                        <LogoutNavButton />
                    </nav>

                    <Switch>
                        <Route path="/"><Redirect to="/map" /></Route>
                        <Route path="/map" component={DistrictMap} />
                        <Route path="/roster" component={Roster} />
                        <Route path="/legislator/:id">
                            {(params) => <LegislatorDetail id={Number(params.id)} />}
                        </Route>
                        <Route path="/rollcall/:id">
                            {(params) => <RollCallDetail id={Number(params.id)} />}
                        </Route>
                        <Route path="/agenda/:chamber">
                            {(params) => {
                                const c = params.chamber?.toUpperCase();
                                return (c === 'H' || c === 'S')
                                    ? <AgendaView chamber={c} />
                                    : <AgendaView chamber="H" />;
                            }}
                        </Route>
                        <Route path="/agenda" component={() => <AgendaView chamber="H" />} />
                        <Route><Redirect to="/map" /></Route>
                    </Switch>
                </main>
                <footer className="box-border mx-auto w-full max-w-260 px-4 pb-8 font-serif text-(--app-subtitle) text-sm border-t border-(--app-ink)/20 pt-4">
                    <FooterFeedback />
                </footer>
            </FeedbackProvider>
        </SessionProvider>
    );
}

function MapNavLink() {
    const [onMap]  = useRoute('/map');
    const [onRoot] = useRoute('/');
    return <Link href="/map" className={navLinkClass(onMap || onRoot)}>District Map</Link>;
}

function RosterNavLink() {
    const [onRoster]     = useRoute('/roster');
    const [onLegislator] = useRoute('/legislator/:id');
    return <Link href="/roster" className={navLinkClass(onRoster || onLegislator)}>Roster</Link>;
}

function AgendaNavLink() {
    const [active, params] = useRoute('/agenda/:chamber');
    const label = active && params?.chamber
        ? `Agenda · ${params.chamber === 'H' ? 'House' : 'Senate'}`
        : 'Agenda';
    return <Link href="/agenda/H" className={navLinkClass(active)}>{label}</Link>;
}

function AdminNavLink() {
    const { isAdmin } = useAdmin();
    const [active]    = useRoute('/admin');
    if (!isAdmin) return null;
    return (
        <Link href="/admin" className={`ml-auto ${navLinkClass(active)}`}>
            Admin
        </Link>
    );
}

function LogoutNavButton() {
    const { isAdmin, logout } = useAdmin();
    if (!isAdmin) return null;
    return (
        <button
            onClick={logout}
            className={`cursor-pointer bg-transparent border-none p-0 font-inherit text-[0.95rem] ${navLinkClass(false)}`}
        >
            Log out
        </button>
    );
}

function App() {
    return (
        <AdminProvider>
            <DebugProvider>
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
                <DebugPanel />
            </DebugProvider>
        </AdminProvider>
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
