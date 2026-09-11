import { lazy, Suspense, useEffect, useState } from 'react';
import { User, Chantier, WeeklyKmPromptStatus } from './types.ts';
import { Dashboard } from './components/Dashboard';
import { Login } from './components/Login';
import { ChangePasswordGate } from './components/ChangePasswordGate';
import { MfaEnrollFlow } from './components/MfaEnrollFlow';
import { Layout } from './components/Layout';
import { NoticeBanner } from './components/NoticeBanner';
import { WeeklyKmPrompt } from './components/WeeklyKmPrompt';
import { api, UNAUTHORIZED_EVENT, ONBOARDING_REQUIRED_EVENT } from './api';
import { trySyncQueue } from './offlineQueue';
import { useInactivityLogout } from './hooks/useInactivityLogout';

// Most sessions only ever touch Dashboard (and maybe one ChantierDetail) —
// keeping Login/Dashboard in the main bundle and splitting the rest out
// means the first load (often on a weak chantier signal) ships less JS.
const ChantierDetail = lazy(() => import('./components/ChantierDetail').then(m => ({ default: m.ChantierDetail })));
const AdminUsers = lazy(() => import('./components/AdminUsers').then(m => ({ default: m.AdminUsers })));
const AdminEntries = lazy(() => import('./components/AdminEntries').then(m => ({ default: m.AdminEntries })));
const MissingEntries = lazy(() => import('./components/MissingEntries').then(m => ({ default: m.MissingEntries })));
const AdminLeaves = lazy(() => import('./components/AdminLeaves').then(m => ({ default: m.AdminLeaves })));
const Planning = lazy(() => import('./components/Planning').then(m => ({ default: m.Planning })));
const Agenda = lazy(() => import('./components/Agenda').then(m => ({ default: m.Agenda })));
const MesConges = lazy(() => import('./components/MesConges').then(m => ({ default: m.MesConges })));
const PotAChantier = lazy(() => import('./components/PotAChantier').then(m => ({ default: m.PotAChantier })));
const GlobalStats = lazy(() => import('./components/GlobalStats').then(m => ({ default: m.GlobalStats })));
const AdminNotices = lazy(() => import('./components/AdminNotices').then(m => ({ default: m.AdminNotices })));
const Vehicules = lazy(() => import('./components/Vehicules').then(m => ({ default: m.Vehicules })));
const PrevisionAnnuelle = lazy(() => import('./components/PrevisionAnnuelle').then(m => ({ default: m.PrevisionAnnuelle })));

const PageLoader = () => (
    <div className="flex items-center justify-center h-full min-h-[50vh]">
        <div className="w-8 h-8 border-2 border-primary/30 border-t-primary rounded-full animate-spin" />
    </div>
);

type View = 'dashboard' | 'admin' | 'admin-entries' | 'missing-entries' | 'admin-leaves' | 'planning' | 'agenda' | 'mes-conges' | 'pot-a-chantier' | 'vehicules' | 'stats' | 'notices' | 'prevision';
const VALID_VIEWS: View[] = ['dashboard', 'admin', 'admin-entries', 'missing-entries', 'admin-leaves', 'planning', 'agenda', 'mes-conges', 'pot-a-chantier', 'vehicules', 'stats', 'notices', 'prevision'];

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

    // Popup hebdo de relevé km (voir WeeklyKmPrompt.tsx) : showKmPopup pilote
    // l'affichage du Oui/Non, kmPending le blocage de navigation une fois
    // "Oui" cliqué — mutuellement exclusifs côté serveur (voir
    // get_weekly_km_prompt_status dans app.py), jamais les deux à true.
    // kmStatusChecked distingue "pas encore su" de "su, rien à faire" — sans
    // lui, le premier rendu (kmPending initialisé à false) affiche brièvement
    // le contenu normal avant que le fetch ci-dessous ne corrige, le temps
    // d'un aller-retour réseau (flash visible sur un F5 pendant un blocage
    // actif). Tant qu'il est false, le rendu affiche un loader neutre au
    // lieu de trancher sur une valeur pas encore fiable.
    const [showKmPopup, setShowKmPopup] = useState(false);
    const [kmPending, setKmPending] = useState(false);
    const [kmStatusChecked, setKmStatusChecked] = useState(false);

    const handleLogout = () => {
        api.post('/api/logout').catch(() => {}); // best-effort, clears the server-side cookie
        setUser(null);
        setView('dashboard');
        setSelectedChantierId(null);
        setSelectedChantier(null);
        setShowKmPopup(false);
        setKmPending(false);
        setKmStatusChecked(false);
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

    // Any onboarding 403 from anywhere in the app (see api.ts) means our
    // local `user` is stale — e.g. an admin reset this account's
    // password/2FA while it was still browsing, so the cookie is still
    // valid but token_required now blocks it. Re-fetch /api/me so the
    // must_change_password/mfa_required gates below pick up the real
    // state and redirect on their own, instead of the user seeing generic
    // errors on every action until they happen to reload the page.
    useEffect(() => {
        const onOnboardingRequired = () => {
            (async () => {
                const res = await api.get('/api/me');
                if (res.ok) setUser(await res.json());
            })();
        };
        window.addEventListener(ONBOARDING_REQUIRED_EVENT, onOnboardingRequired);
        return () => window.removeEventListener(ONBOARDING_REQUIRED_EVENT, onOnboardingRequired);
    }, []);

    // Auto-logout after no interaction anywhere in the app (mouse/keyboard/
    // touch/scroll) — matches the session cookie's own per-role lifetime
    // (see COOKIE_MAX_AGE_ADMIN/COOKIE_MAX_AGE_DEFAULT in app.py, kept in
    // sync manually): 24h for admin, 5 days for user/depanneur/vehicule.
    // Was a flat 20 minutes; bumped at the user's explicit request (an
    // admin got logged out mid-away-from-keyboard and found 20min too
    // aggressive) — the cookie's own expiry is now effectively the only
    // backstop, this no longer catches "stepped away for a few minutes".
    const inactivityMinutes = user?.role === 'admin' ? 24 * 60 : 5 * 24 * 60;
    useInactivityLogout(handleLogout, inactivityMinutes, !!user);

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
            if (kmPending) {
                // Back/forward pendant un blocage actif : reclamp l'URL sur
                // Véhicules au lieu de la laisser dériver (effectiveView au
                // rendu bloquerait de toute façon l'affichage, ceci évite
                // juste que l'URL affichée mente).
                pushUrl('vehicules', null);
                return;
            }
            const p = parseUrl();
            setView(p.view);
            setSelectedChantierId(p.chantierId);
            if (!p.chantierId) setSelectedChantier(null);
        };
        window.addEventListener('popstate', onPopState);
        return () => window.removeEventListener('popstate', onPopState);
    }, [kmPending]);

    // A refresh (or a direct link) only has the chantier ID from the URL —
    // fetch its full data before we can render ChantierDetail with it.
    useEffect(() => {
        if (!user || !selectedChantierId) return;
        if (selectedChantier?.id === selectedChantierId) return;
        // Onboarding not finished yet (see the gates below, right after
        // this component's other hooks) — this fetch would 403, and
        // previously the else branch below treated that identically to
        // "chantier gone", discarding selectedChantierId for good. Wait
        // instead: this effect re-runs on every `user` change, including
        // the one ChangePasswordGate/MfaEnrollFlow's onChanged/onComplete
        // triggers once onboarding actually finishes — the deep link
        // resolves then instead of being lost.
        if (user.must_change_password || (user.mfa_required && !user.mfa_enabled)) return;
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

    // Popup hebdo de relevé km — vérifié à l'ouverture de l'app (une fois par
    // user connecté, pas en polling continu : "à l'ouverture de l'app" dans
    // le prompt initial). Attend que l'onboarding (mdp/2FA) soit fini, sinon
    // l'appel 403erait avant même d'atteindre Layout.
    //
    // Dépendances : PAS juste user?.id — must_change_password/mfa_required/
    // mfa_enabled changent sans changer l'id (ChangePasswordGate/
    // MfaEnrollFlow appellent setUser avec le même compte). Avec [user?.id]
    // seul, ce check ne se relançait jamais pour un compte qui finit son
    // onboarding dans la même session : le premier passage (juste après
    // login, onboarding pas fini) sortait tout de suite via le guard
    // ci-dessous, et l'id ne changeant plus jamais ensuite, l'effect ne
    // repassait plus — le popup/blocage ne se déclenchait alors jamais pour
    // ce compte tant qu'il restait sur la même page.
    useEffect(() => {
        if (!user || user.must_change_password || (user.mfa_required && !user.mfa_enabled)) return;
        setKmStatusChecked(false); // voir déclaration : neutralise le rendu pendant l'aller-retour réseau
        (async () => {
            try {
                const res = await api.get('/api/weekly-km-prompt/status');
                if (res.ok) {
                    const data: WeeklyKmPromptStatus = await res.json();
                    setKmPending(data.pending_km_entry);
                    setShowKmPopup(data.show_popup);
                }
            } finally {
                setKmStatusChecked(true);
            }
        })();
    }, [user?.id, user?.must_change_password, user?.mfa_required, user?.mfa_enabled]);

    // "Non" referme simplement. "Oui" n'est jamais fermé par ce composant —
    // il bascule en mode bloqué et atterrit sur Véhicules, où seul un relevé
    // effectivement soumis lève le blocage (voir Vehicules.tsx
    // onKmEntrySubmitted et handleKmEntrySubmitted ci-dessous).
    const handleKmPromptAnswered = (pendingKmEntry: boolean) => {
        setShowKmPopup(false);
        setKmPending(pendingKmEntry);
        if (pendingKmEntry) {
            setSelectedChantier(null);
            setSelectedChantierId(null);
            setView('vehicules');
            pushUrl('vehicules', null);
        }
    };

    const handleKmEntrySubmitted = () => setKmPending(false);

    // Login.tsx drives the whole password/2FA flow itself (it may be a
    // multi-step exchange: password -> mfa code -> enroll) and only calls
    // this once a real session actually exists.
    const handleLoginSuccess = (loggedInUser: User) => setUser(loggedInUser);

    const handleNavigate = (path: string) => {
        // Blocage actif (a répondu "Oui", km pas encore soumis) : la vraie
        // application du blocage est au rendu (effectiveView plus bas, qui
        // force Véhicules quoi qu'il arrive) — ce guard n'est là que pour ne
        // pas laisser l'URL dériver vers autre chose pendant ce temps.
        if (kmPending && path !== 'vehicules') return;
        if (user?.role === 'vehicule' && path !== 'vehicules') return;
        setSelectedChantier(null);
        setSelectedChantierId(null);
        let next: View = 'dashboard';
        if (path === 'dashboard') next = 'dashboard';
        else if (path === 'admin-users') next = 'admin';
        else if (path === 'admin-entries') next = 'admin-entries';
        else if (path === 'missing-entries') next = 'missing-entries';
        else if (path === 'admin-leaves') next = 'admin-leaves';
        else if (path === 'planning') next = 'planning';
        else if (path === 'agenda') next = 'agenda';
        else if (path === 'mes-conges') next = 'mes-conges';
        else if (path === 'pot-a-chantier') next = 'pot-a-chantier';
        else if (path === 'vehicules') next = 'vehicules';
        else if (path === 'stats') next = 'stats';
        else if (path === 'notices') next = 'notices';
        else if (path === 'prevision') next = 'prevision';
        setView(next);
        pushUrl(next, null);
    };

    const handleSelectChantier = (c: Chantier) => {
        if (kmPending) return; // même raison que handleNavigate ci-dessus
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
        return <Login onLoginSuccess={handleLoginSuccess} />;
    }

    // Onboarding order enforced here AND server-side (token_required's
    // onboarding check in app.py) — password first, then 2FA. A temp
    // password only ever proves identity for these two steps until both
    // are done (see MFA_REQUIRED_ROLES comment in app.py for why).
    if (user.must_change_password) {
        return <ChangePasswordGate user={user} onChanged={setUser} />;
    }

    if (user.mfa_required && !user.mfa_enabled) {
        return (
            <div className="h-[100dvh] flex items-center justify-center p-4 bg-ohm-bg safe-top safe-bottom safe-left safe-right overflow-y-auto">
                <div className="w-full max-w-sm">
                    <p className="text-slate-400 text-sm text-center mb-4">
                        La double authentification est obligatoire sur ce compte — dernière étape avant de continuer.
                    </p>
                    <MfaEnrollFlow onComplete={setUser} />
                </div>
            </div>
        );
    }

    // Blocage km en attente : force Véhicules quoi qu'il arrive, peu importe
    // ce que view/selectedChantier valent par ailleurs — c'est la seule
    // application du blocage qui compte réellement (les guards dans
    // handleNavigate/handleSelectChantier/onPopState ne servent qu'à éviter
    // que l'URL dérive, pas à faire respecter le blocage lui-même).
    //
    // CHOIX ASSUMÉ, pas un oubli : ce blocage n'existe QUE côté frontend.
    // Aucun endpoint (/api/chantiers, /api/entries, etc.) ne vérifie
    // pending_km_entry côté serveur — contrairement à must_change_password/
    // mfa_enroll_required (voir token_required dans app.py), qui EUX sont
    // appliqués aussi côté serveur. Un user qui appelle l'API directement
    // (devtools, JS désactivé) contourne ce blocage sans même chercher un
    // chemin de navigation oublié : il n'y a rien à contourner côté serveur.
    // Volontaire : c'est un rappel hebdomadaire, pas une frontière de
    // sécurité/permissions — si ça devait un jour le devenir, il faudrait
    // ajouter un check équivalent dans token_required, pas seulement ici.
    // 'vehicule' (garagiste externe) locked to Véhicules, same forcing
    // pattern as kmPending above — the backend already 403s everything
    // else for this role (token_required), this just avoids ever trying
    // to render a page that would immediately fail to load.
    const lockedToVehicules = kmPending || user.role === 'vehicule';
    const effectiveView: View = lockedToVehicules ? 'vehicules' : view;
    const effectiveChantier = lockedToVehicules ? null : selectedChantier;

    return (
        <Layout
            user={user}
            activeView={effectiveView}
            onLogout={handleLogout}
            onNavigate={handleNavigate}
        >
            <NoticeBanner />
            {showKmPopup && <WeeklyKmPrompt onAnswered={handleKmPromptAnswered} />}
            <Suspense fallback={<PageLoader />}>
                {!kmStatusChecked ? (
                    // Le statut du popup hebdo (kmPending en particulier)
                    // n'est pas encore fiable — trancher maintenant sur
                    // kmPending=false (sa valeur initiale) afficherait la vue
                    // normale un instant avant de basculer sur Véhicules si
                    // le fetch revient bloqué (flash visible sur un F5
                    // pendant un blocage actif). Neutre le temps de l'aller-
                    // retour réseau plutôt que de deviner.
                    <PageLoader />
                ) : effectiveChantier ? (
                    // Vérifié avant les vues nommées : sinon un chantier ouvert
                    // depuis l'Agenda ("Voir le chantier") reste bloqué sur
                    // view === 'agenda' et ne s'affiche jamais (bug corrigé).
                    // onBack referme juste selectedChantier, view ne change
                    // pas — on revient exactement là où on était (Agenda ou
                    // Dashboard selon d'où on est venu).
                    <ChantierDetail
                        chantier={effectiveChantier}
                        currentUser={user}
                        onBack={handleBackFromChantier}
                    />
                ) : effectiveView === 'admin' ? (
                    <AdminUsers currentUser={user} />
                ) : effectiveView === 'planning' ? (
                    <Planning currentUser={user} />
                ) : effectiveView === 'agenda' ? (
                    <Agenda currentUser={user} onOpenChantier={handleSelectChantier} />
                ) : effectiveView === 'mes-conges' ? (
                    <MesConges currentUser={user} />
                ) : effectiveView === 'pot-a-chantier' && user.role !== 'user' ? (
                    // role !== 'user' (pas juste masqué dans la nav, voir
                    // Layout.tsx visibleNavItems) : un lien direct par URL
                    // (?view=pot-a-chantier) ne doit pas non plus donner
                    // accès. Si la condition est fausse, retombe sur le
                    // fallback Dashboard tout en bas de cette chaîne.
                    <PotAChantier currentUser={user} />
                ) : effectiveView === 'vehicules' ? (
                    <Vehicules currentUser={user} onKmEntrySubmitted={handleKmEntrySubmitted} />
                ) : effectiveView === 'stats' ? (
                    <GlobalStats />
                ) : effectiveView === 'admin-entries' ? (
                    <AdminEntries currentUser={user} />
                ) : effectiveView === 'missing-entries' ? (
                    <MissingEntries />
                ) : effectiveView === 'admin-leaves' ? (
                    <AdminLeaves />
                ) : effectiveView === 'notices' ? (
                    <AdminNotices />
                ) : effectiveView === 'prevision' ? (
                    <PrevisionAnnuelle />
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
