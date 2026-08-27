import React, { useEffect, useState } from 'react';
import { OhmIcon } from './Icons';
import { LayoutDashboard, Calendar, Users, ClipboardCheck, LogOut, BarChart3, Menu, X, ChevronRight } from 'lucide-react';
import { MODAL_STATE_EVENT } from '../modalState';

interface User {
    username: string;
    role: string;
}

type View = 'dashboard' | 'admin' | 'admin-entries' | 'planning' | 'stats';

interface LayoutProps {
    children: React.ReactNode;
    user?: User;
    activeView: View;
    onLogout: () => void;
    onNavigate: (path: string) => void;
}

const NAV_ITEMS = [
    { path: 'dashboard', view: 'dashboard' as View, icon: LayoutDashboard, label: 'Tableau de bord' },
    { path: 'planning', view: 'planning' as View, icon: Calendar, label: 'Planning & Congés' },
];

const ADMIN_NAV_ITEMS = [
    { path: 'stats', view: 'stats' as View, icon: BarChart3, label: 'Statistiques' },
    { path: 'admin-users', view: 'admin' as View, icon: Users, label: 'Gestion Utilisateurs' },
    { path: 'admin-entries', view: 'admin-entries' as View, icon: ClipboardCheck, label: 'Validation Saisies' },
];

export const Layout: React.FC<LayoutProps> = ({ children, user, activeView, onLogout, onNavigate }) => {
    const [drawerOpen, setDrawerOpen] = useState(false);
    // Collapsing mobile header: full bar at scroll top, shrinks to a small
    // floating button once the page scrolls so it stops covering content.
    const [scrolled, setScrolled] = useState(false);
    // A page-level modal (e.g. ChantierDetail's entry form) tells us it's
    // open so we hide our own nav bar/floating button and stop background
    // scroll — otherwise the app chrome sits on top of / behind the modal.
    const [pageModalOpen, setPageModalOpen] = useState(false);
    useEffect(() => {
        const onModalState = (e: Event) => setPageModalOpen((e as CustomEvent<boolean>).detail);
        window.addEventListener(MODAL_STATE_EVENT, onModalState);
        return () => window.removeEventListener(MODAL_STATE_EVENT, onModalState);
    }, []);

    // Close the drawer automatically if the viewport grows into the desktop
    // layout (e.g. phone rotated to a tablet-sized landscape, or a resize).
    useEffect(() => {
        const mq = window.matchMedia('(min-width: 1024px)');
        const onChange = () => { if (mq.matches) setDrawerOpen(false); };
        mq.addEventListener('change', onChange);
        return () => mq.removeEventListener('change', onChange);
    }, []);

    // Lock background scroll while the drawer or a page-level modal is open.
    // Plain `overflow:hidden` on body isn't enough on iOS Safari — it still
    // lets a touch that starts behind a fixed overlay drag the page. Pinning
    // body itself with position:fixed is the reliable cross-browser lock.
    useEffect(() => {
        const locked = drawerOpen || pageModalOpen;
        if (locked) {
            const scrollY = window.scrollY;
            document.body.style.position = 'fixed';
            document.body.style.top = `-${scrollY}px`;
            document.body.style.left = '0';
            document.body.style.right = '0';
            document.body.style.overflow = 'hidden';
        } else {
            const top = document.body.style.top;
            document.body.style.position = '';
            document.body.style.top = '';
            document.body.style.left = '';
            document.body.style.right = '';
            document.body.style.overflow = '';
            if (top) window.scrollTo(0, -parseInt(top, 10) || 0);
        }
    }, [drawerOpen, pageModalOpen]);

    const handleNavigate = (path: string) => {
        onNavigate(path);
        setDrawerOpen(false);
    };

    return (
        <div className="flex h-[100dvh] bg-background text-text overflow-hidden relative selection:bg-primary/30">
            {/* Background Ambience */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[128px] opacity-20 animate-pulse-slow"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[128px] opacity-20 animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
            </div>

            {/* ===== Desktop Sidebar (lg and up) ===== */}
            <aside className="hidden lg:flex fixed left-4 top-4 bottom-4 z-50 w-20 hover:w-72 bg-glass backdrop-blur-xl border border-black/5 shadow-glass rounded-2xl transition-all duration-500 ease-in-out group flex-col overflow-hidden">
                <div className="h-24 flex items-center justify-start px-0 relative w-full shrink-0">
                    <button onClick={() => handleNavigate('dashboard')} className="flex items-center w-full h-full px-4 group-hover:px-6 transition-all duration-300">
                        <div className="w-12 h-12 flex items-center justify-center flex-shrink-0 relative">
                            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                            <OhmIcon />
                        </div>
                        <div className="w-0 overflow-hidden group-hover:w-auto transition-all duration-500 ease-in-out flex flex-col justify-center ml-0 group-hover:ml-4 opacity-0 group-hover:opacity-100">
                            <span className="font-display font-bold text-2xl tracking-tight text-slate-900 whitespace-nowrap">
                                OHM<span className="text-primary drop-shadow-[0_0_10px_rgba(255,215,0,0.5)]">FLOW</span>
                            </span>
                        </div>
                    </button>
                    <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </div>

                <nav className="flex-1 py-6 px-3 space-y-2 flex flex-col w-full overflow-y-auto overflow-x-hidden no-scrollbar">
                    {NAV_ITEMS.map(item => (
                        <NavItem key={item.path} icon={<item.icon size={22} />} label={item.label} active={activeView === item.view} onClick={() => handleNavigate(item.path)} />
                    ))}

                    {user?.role === 'admin' && (
                        <div className="pt-4 mt-2 border-t border-black/5 mx-2">
                            <div className="hidden group-hover:block px-2 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest mb-3 animate-fade-in pl-4">
                                Administration
                            </div>
                            {ADMIN_NAV_ITEMS.map(item => (
                                <NavItem key={item.path} icon={<item.icon size={22} />} label={item.label} active={activeView === item.view} onClick={() => handleNavigate(item.path)} />
                            ))}
                        </div>
                    )}
                </nav>

                <div className="p-3 mt-auto relative z-10 w-full flex justify-center">
                    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-2 border border-black/5 flex items-center gap-3 w-full overflow-hidden transition-all duration-300 hover:bg-white/10 group-hover:px-3 px-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary-dark flex items-center justify-center font-bold text-black shadow-lg shrink-0 mx-auto group-hover:mx-0 transition-all">
                            {user?.username?.[0].toUpperCase() || 'G'}
                        </div>
                        <div className="flex flex-col min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75 w-0 group-hover:w-auto">
                            <span className="font-bold text-slate-900 text-sm truncate">{user?.username || 'Guest'}</span>
                            <span className="text-[10px] uppercase text-primary font-bold tracking-wider truncate">{user?.role || 'Visiteur'}</span>
                        </div>
                        <button
                            onClick={onLogout}
                            className="ml-auto p-1.5 rounded-lg hover:bg-red-500/20 text-text-muted hover:text-red-400 transition-all opacity-0 group-hover:opacity-100 translate-x-10 group-hover:translate-x-0 duration-300"
                            title="Déconnexion"
                        >
                            <LogOut size={16} />
                        </button>
                    </div>
                </div>
            </aside>

            {/* ===== Mobile Top Bar (below lg) — full bar at scroll-top, collapses
                once the page scrolls so it stops covering content ===== */}
            <header
                className={`lg:hidden fixed top-0 left-0 right-0 z-40 safe-top transition-all duration-300 ${scrolled || pageModalOpen ? '-translate-y-full opacity-0 pointer-events-none' : 'translate-y-0 opacity-100'
                    }`}
            >
                <div className="flex items-center justify-between h-16 px-4 bg-glass backdrop-blur-xl border-b border-black/5 shadow-glass">
                    <button
                        onClick={() => setDrawerOpen(true)}
                        className="p-2 -ml-2 rounded-xl text-slate-700 hover:bg-black/5 active:scale-95 transition-all"
                        aria-label="Ouvrir le menu"
                    >
                        <Menu size={24} />
                    </button>
                    <div className="flex items-center gap-2">
                        <OhmIcon className="w-6 h-6 text-primary" />
                        <span className="font-display font-bold text-lg tracking-tight text-slate-900">
                            OHM<span className="text-primary">FLOW</span>
                        </span>
                    </div>
                    <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-primary-dark flex items-center justify-center font-bold text-black text-sm shrink-0">
                        {user?.username?.[0].toUpperCase() || 'G'}
                    </div>
                </div>
            </header>

            {/* Floating menu-access button — replaces the bar once scrolled, stays
                reachable everywhere in the app without eating screen space */}
            <button
                onClick={() => setDrawerOpen(true)}
                aria-label="Ouvrir le menu"
                className={`lg:hidden fixed z-40 top-[calc(0.75rem+env(safe-area-inset-top))] left-3 w-11 h-11 rounded-full bg-glass backdrop-blur-xl border border-black/5 shadow-glass flex items-center justify-center text-slate-700 active:scale-90 transition-all duration-300 ${scrolled && !pageModalOpen ? 'opacity-100 scale-100' : 'opacity-0 scale-75 pointer-events-none'
                    }`}
            >
                <ChevronRight size={20} />
            </button>

            {/* ===== Mobile Drawer (below lg) ===== */}
            {drawerOpen && (
                <div className="lg:hidden fixed inset-0 z-50">
                    <div
                        className="absolute inset-0 bg-black/40 backdrop-blur-sm animate-fade-in touch-none"
                        onClick={() => setDrawerOpen(false)}
                    />
                    <div className="absolute left-0 top-0 bottom-0 w-[82%] max-w-xs bg-surface shadow-2xl flex flex-col animate-slide-in-right safe-top safe-bottom">
                        <div className="h-16 flex items-center justify-between px-5 border-b border-slate-200 shrink-0">
                            <div className="flex items-center gap-2">
                                <OhmIcon className="w-6 h-6 text-primary" />
                                <span className="font-display font-bold text-lg tracking-tight text-slate-900">
                                    OHM<span className="text-primary">FLOW</span>
                                </span>
                            </div>
                            <button
                                onClick={() => setDrawerOpen(false)}
                                className="p-2 rounded-xl text-slate-500 hover:bg-black/5 active:scale-95 transition-all"
                                aria-label="Fermer le menu"
                            >
                                <X size={22} />
                            </button>
                        </div>

                        <nav className="flex-1 py-4 px-3 space-y-1 overflow-y-auto">
                            {NAV_ITEMS.map(item => (
                                <NavItemMobile key={item.path} icon={<item.icon size={22} />} label={item.label} active={activeView === item.view} onClick={() => handleNavigate(item.path)} />
                            ))}

                            {user?.role === 'admin' && (
                                <div className="pt-4 mt-3 border-t border-slate-200">
                                    <div className="px-4 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest mb-2">
                                        Administration
                                    </div>
                                    {ADMIN_NAV_ITEMS.map(item => (
                                        <NavItemMobile key={item.path} icon={<item.icon size={22} />} label={item.label} active={activeView === item.view} onClick={() => handleNavigate(item.path)} />
                                    ))}
                                </div>
                            )}
                        </nav>

                        <div className="p-3 shrink-0 border-t border-slate-200">
                            <div className="bg-slate-50 rounded-xl p-3 flex items-center gap-3">
                                <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-primary to-primary-dark flex items-center justify-center font-bold text-black shrink-0">
                                    {user?.username?.[0].toUpperCase() || 'G'}
                                </div>
                                <div className="flex flex-col min-w-0 flex-1">
                                    <span className="font-bold text-slate-900 text-sm truncate">{user?.username || 'Guest'}</span>
                                    <span className="text-[10px] uppercase text-primary font-bold tracking-wider truncate">{user?.role || 'Visiteur'}</span>
                                </div>
                                <button
                                    onClick={onLogout}
                                    className="p-2 rounded-lg hover:bg-red-500/10 text-text-muted hover:text-red-500 transition-all"
                                    title="Déconnexion"
                                    aria-label="Déconnexion"
                                >
                                    <LogOut size={18} />
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Main Content Area */}
            {/* pt uses calc() instead of the safe-top utility: the fixed mobile header's
                own height already includes the safe-area inset (via its safe-top class),
                so content below it needs header-height (4rem) PLUS that same inset —
                a plain pt-16 was letting the header's notch-padding overlap the page title. */}
            <main
                onScroll={(e) => setScrolled(e.currentTarget.scrollTop > 24)}
                className={`flex-1 w-full max-w-[1920px] transition-all duration-300 min-h-0 z-10 pt-[calc(4rem+env(safe-area-inset-top))] lg:pt-8 lg:ml-28 px-4 pb-8 lg:pr-8 lg:pl-0 safe-bottom safe-left safe-right overflow-x-hidden ${(drawerOpen || pageModalOpen) ? 'overflow-y-hidden' : 'overflow-y-auto'}`}
            >
                {children}
            </main>
        </div>
    );
};

// Desktop nav item (hover-reveal label)
const NavItem = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`w-full h-14 flex items-center gap-4 px-3 rounded-2xl relative group/item overflow-hidden transition-all duration-300 hover:shadow-md ${active ? 'text-slate-900 bg-black/5' : 'text-text-muted hover:text-slate-900 hover:bg-black/5'
            }`}
    >
        <div className={`w-8 flex justify-center flex-shrink-0 relative z-10 transition-transform duration-300 group-hover/item:scale-110 ${active ? 'text-primary drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]' : 'group-hover/item:text-primary group-hover/item:drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]'
            }`}>
            {icon}
        </div>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-bold text-base whitespace-nowrap delay-75 relative z-10 tracking-wide">
            {label}
        </span>

        <div className={`absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full transition-all duration-300 shadow-[0_0_10px_rgba(255,215,0,0.8)] ${active ? 'opacity-100' : 'opacity-0 group-hover/item:opacity-100'
            }`} />
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-500 ease-out" />
    </button>
);

// Mobile drawer nav item (label always visible — no hover on touch devices)
const NavItemMobile = ({ icon, label, active, onClick }: { icon: React.ReactNode, label: string, active?: boolean, onClick: () => void }) => (
    <button
        onClick={onClick}
        className={`w-full h-12 flex items-center gap-4 px-4 rounded-xl font-bold text-sm transition-all active:scale-[0.98] ${active ? 'bg-primary/10 text-primary' : 'text-slate-600 hover:bg-black/5 hover:text-slate-900'
            }`}
    >
        <div className="w-6 flex justify-center flex-shrink-0">{icon}</div>
        <span className="tracking-wide">{label}</span>
    </button>
);
