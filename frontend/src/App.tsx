import { lazy, Suspense, useEffect, useState } from 'react';
import { User, Chantier } from './types.ts';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { Layout } from './components/Layout';
import { api, UNAUTHORIZED_EVENT } from './api';
import { trySyncQueue } from './offlineQueue';

// Most sessions only ever touch Dashboard (and maybe one ChantierDetail) —
// keeping Login/Dashboard in the main bundle and splitting the rest out
// means the first load (often on a weak chantier signal) ships less JS.
const ChantierDetail = lazy(() => import('./components/ChantierDetail').then(m => ({ default: m.ChantierDetail })));
const AdminUsers = lazy(() => import('./components/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminEntries = lazy(() => import('./components/AdminEntries').then(m => ({ default: m.AdminEntries })));
const Planning = lazy(() => import('./components/Planning').then(m => ({ default: m.Planning })));
const GlobalStats = lazy(() => import('./components/GlobalStats').then(m => ({ default: m.GlobalStats })));

const PageLoader = () => (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
);

type View = 'dashboard' | 'admin' | 'admin-entries' | 'planning' | 'stats';
const VALID_VIEWS: View[] = ['dashboard', 'admin', 'admin-entries', 'planning', 'stats'];

// Reads the current view/selected-chantier out of the URL — used both on
// first load and whenever the user hits browser back/forward.
const parseUrl = (): { view: View; chantierId: number | null } => {
    const params = new URLSearchParams(window.location.search);
    const chantierParam = params.get('chantier');
    if (chantierParam && /^\d+$/.test(chantierParam)) {
        return { view: 'dashboard', chantierId: parseInt(chantierParam, 10) };
    }
    const v = params.get('view');
    return { view: (VALID_VIEWS as string[]).includes(v || '') ? (v as View) : 'dashboard', chantierId: null };
};

const pushUrl = (view: View, chantierId: number | null) => {
    const params = new URLSearchParams();
    if (chantierId) params.set('chantier', String(chantierId));
    else if (view !== 'dashboard') params.set('view', view);
    const qs = params.toString();
    window.history.pushState({ view, chantierId }, '', qs ? `/?${qs}` : '/');
};

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [checkingSession, setCheckingSession] = useState(true);

    const initial = parseUrl();
    const [view, setView] = useState<View>(initial.view);
    const [selectedChantierId, setSelectedChantierId] = useState<number | null>(initial.chantierId);
    const [selectedChantier, setSelectedChantier] = useState<Chantier | null>(null);

    const handleLogout = () => {
        api.post('/api/logout').catch(() => {}); // best-effort, clears the server-side cookie
        setUser(null);
        setView('dashboard');
        setSelectedChantierId(null);
        setSelectedChantier(null);
        window.history.pushState({}, '', '/');
    };

    // Restore session on page load (cookie is httpOnly — ask the backend who we are).
    useEffect(() => {
        (async () => {
            try {
                const res = await api.get('/api/me');
                if (res.ok) setUser(await res.json());
            } finally {
                setCheckingSession(false);
            }
        })();
    }, []);

    // Any 401 from anywhere in the app drops us back to the login screen.
    useEffect(() => {
        const onUnauthorized = () => handleLogout();
        window.addEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
        return () => window.removeEventListener(UNAUTHORIZED_EVENT, onUnauthorized);
    }, []);

    // Flush any offline-queued entries: on load (in case we started this
    // session already back online with leftovers), whenever the browser
    // reports coming back online, and periodically in the background —
    // navigator.onLine can say "online" while a weak chantier signal still
    // fails every request, so a dumb interval retry catches that too.
    useEffect(() => {
        const sync = () => trySyncQueue(api.post);
        sync();
        window.addEventListener('online', sync);
        const interval = setInterval(sync, 20000);
        return () => {
            window.removeEventListener('online', sync);
            clearInterval(interval);
        };
    }, []);

    // Browser back/forward — re-sync state from the URL instead of navigating away.
    useEffect(() => {
        const onPopState = () => {
            const p = parseUrl();
            setView(p.view);
            setSelectedChantierId(p.chantierId);
            if (!p.chantierId) setSelectedChantier(null);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, []);

    // A refresh (or a direct link) only has the chantier ID from the URL —
    // fetch its full data before we can render ChantierDetail with it.
    useEffect(() => {
        if (!user || !selectedChantierId) return;
        if (selectedChantier?.id === selectedChantierId) return;
        (async () => {
            const res = await api.get(`/api/chantiers/${selectedChantierId}`);
            if (res.ok) {
                setSelectedChantier(await res.json());
            } else {
                // Chantier gone/inaccessible — fall back to the dashboard instead of a dead end.
                setSelectedChantierId(null);
                pushUrl('dashboard', null);
            }
        })();
    }, [user, selectedChantierId]);

    const handleLogin = async (pin: string): Promise<boolean> => {
        try {
            const res = await api.post('/api/login', { pin });
            if (res.ok) {
                setUser(await res.json());
                return true;
            }
            return false;
        } catch (err) {
            console.error(err);
            return false;
        }
    };

    const handleNavigate = (path: string) => {
        setSelectedChantier(null);
        setSelectedChantierId(null);
        let next: View = 'dashboard';
        if (path === 'dashboard') next = 'dashboard';
        else if (path === 'admin-users') next = 'admin';
        else if (path === 'admin-entries') next = 'admin-entries';
        else if (path === 'planning') next = 'planning';
        else if (path === 'stats') next = 'stats';
        setView(next);
        pushUrl(next, null);
    };

    const handleSelectChantier = (c: Chantier) => {
        setSelectedChantier(c);
        setSelectedChantierId(c.id);
        pushUrl(view, c.id);
    };

    const handleBackFromChantier = () => {
        setSelectedChantier(null);
        setSelectedChantierId(null);
        pushUrl(view, null);
    };

    if (checkingSession) {
        return null; // avoid a login-screen flash while the session cookie is being checked
    }

    if (!user) {
        return <Login onLogin={handleLogin} />;
    }

    return (
        <Layout
            user={user}
            activeView={view}
            onLogout={handleLogout}
            onNavigate={handleNavigate}
        >
            <Suspense fallback={<PageLoader />}>
                {view === 'admin' ? (
                    <AdminUsers />
                ) : view === 'planning' ? (
                    <Planning currentUser={user} />
                ) : view === 'stats' ? (
                    <GlobalStats />
                ) : view === 'admin-entries' ? (
                    <AdminEntries currentUser={user} />
                ) : selectedChantier ? (
                    <ChantierDetail
                        chantier={selectedChantier}
                        currentUser={user}
                        onBack={handleBackFromChantier}
                    />
                ) : selectedChantierId ? (
                    null // fetching the chantier for a refreshed/direct link — avoid a dashboard flash
                ) : (
                    <Dashboard
                        currentUser={user}
                        onSelectChantier={handleSelectChantier}
                    />
                )}
            </Suspense>
        </Layout>
    );
}

export default App;
