import React from 'react';
import { OhmIcon } from './Icons';
import { LayoutDashboard, Calendar, Users, ClipboardCheck, LogOut, BarChart3 } from 'lucide-react';
interface User {
    username: string;
    role: string;
}

interface LayoutProps {
    children: React.ReactNode;
    user?: User;
    onLogout: () => void;
    onNavigate: (path: string) => void;
}

export const Layout: React.FC<LayoutProps> = ({ children, user, onLogout, onNavigate }) => {
    return (
        <div className="flex min-h-screen bg-background text-text overflow-hidden relative selection:bg-primary/30">
            {/* Background Ambience */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-10%] left-[-10%] w-[40%] h-[40%] bg-primary/20 rounded-full blur-[128px] opacity-20 animate-pulse-slow"></div>
                <div className="absolute bottom-[-10%] right-[-10%] w-[40%] h-[40%] bg-blue-500/20 rounded-full blur-[128px] opacity-20 animate-pulse-slow" style={{ animationDelay: '2s' }}></div>
            </div>

            {/* Sidebar */}
            <aside className="fixed left-4 top-4 bottom-4 z-50 w-20 hover:w-72 bg-glass backdrop-blur-xl border border-white/10 shadow-glass rounded-2xl transition-all duration-500 ease-in-out group flex flex-col overflow-hidden">

                {/* Logo Area */}
                <div className="h-24 flex items-center justify-start px-0 relative w-full shrink-0">
                    <button onClick={() => onNavigate('dashboard')} className="flex items-center w-full h-full px-4 group-hover:px-6 transition-all duration-300">
                        {/* Icon Container */}
                        <div className="w-12 h-12 flex items-center justify-center flex-shrink-0 relative">
                            <div className="absolute inset-0 bg-primary/20 blur-xl rounded-full opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                            <OhmIcon />
                        </div>
                        {/* Text Container */}
                        <div className="w-0 overflow-hidden group-hover:w-auto transition-all duration-500 ease-in-out flex flex-col justify-center ml-0 group-hover:ml-4 opacity-0 group-hover:opacity-100">
                            <span className="font-display font-bold text-2xl tracking-tight text-white whitespace-nowrap">
                                OHM<span className="text-primary drop-shadow-[0_0_10px_rgba(255,215,0,0.5)]">FLOW</span>
                            </span>
                        </div>
                    </button>
                    {/* Divider */}
                    <div className="absolute bottom-0 left-4 right-4 h-px bg-gradient-to-r from-transparent via-white/10 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500"></div>
                </div>

                {/* Navigation Items */}
                <nav className="flex-1 py-6 px-3 space-y-2 flex flex-col w-full overflow-y-auto overflow-x-hidden scrollbar-hide">

                    <NavItem
                        icon={<LayoutDashboard size={22} />}
                        label="Tableau de bord"
                        onClick={() => onNavigate('dashboard')}
                    />

                    <NavItem
                        icon={<Calendar size={22} />}
                        label="Planning & Congés"
                        onClick={() => onNavigate('planning')}
                    />

                    {user?.role === 'admin' && (
                        <div className="pt-4 mt-2 border-t border-white/5 mx-2">
                            <div className="hidden group-hover:block px-2 text-[10px] font-bold text-text-muted/60 uppercase tracking-widest mb-3 animate-fade-in pl-4">
                                Administration
                            </div>

                            <NavItem
                                icon={<BarChart3 size={22} />}
                                label="Statistiques"
                                onClick={() => onNavigate('stats')}
                            />

                            <NavItem
                                icon={<Users size={22} />}
                                label="Gestion Utilisateurs"
                                onClick={() => onNavigate('admin-users')}
                            />

                            <NavItem
                                icon={<ClipboardCheck size={22} />}
                                label="Validation Saisies"
                                onClick={() => onNavigate('admin-entries')}
                            />
                        </div>
                    )}
                </nav>

                {/* User & Logout */}
                <div className="p-3 mt-auto relative z-10 w-full flex justify-center">
                    <div className="bg-white/5 backdrop-blur-sm rounded-xl p-2 border border-white/5 flex items-center gap-3 w-full overflow-hidden transition-all duration-300 hover:bg-white/10 group-hover:px-3 px-2">
                        <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-primary to-primary-dark flex items-center justify-center font-bold text-black shadow-lg shrink-0 mx-auto group-hover:mx-0 transition-all">
                            {user?.username?.[0].toUpperCase() || 'G'}
                        </div>
                        <div className="flex flex-col min-w-0 opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75 w-0 group-hover:w-auto">
                            <span className="font-bold text-white text-sm truncate">{user?.username || 'Guest'}</span>
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

            {/* Main Content Area */}
            <main className="flex-1 ml-28 py-8 pr-8 w-full max-w-[1920px] transition-all duration-300 h-screen overflow-y-auto z-10">
                {children}
            </main>
        </div>
    );
};

// Helper Component for Nav Items
const NavItem = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className="w-full h-14 flex items-center gap-4 px-3 rounded-2xl text-text-muted hover:text-white hover:bg-white/5 relative group/item overflow-hidden transition-all duration-300 hover:shadow-neon"
    >
        <div className="w-8 flex justify-center flex-shrink-0 relative z-10 transition-transform duration-300 group-hover/item:scale-110 group-hover/item:text-primary group-hover/item:drop-shadow-[0_0_8px_rgba(255,215,0,0.8)]">
            {icon}
        </div>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-bold text-base whitespace-nowrap delay-75 relative z-10 tracking-wide">
            {label}
        </span>

        {/* Active Indicator Bar */}
        <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-primary rounded-r-full opacity-0 group-hover/item:opacity-100 transition-all duration-300 shadow-[0_0_10px_rgba(255,215,0,0.8)]" />

        {/* Hover Gradient Background */}
        <div className="absolute inset-0 bg-gradient-to-r from-primary/10 via-transparent to-transparent opacity-0 group-hover/item:opacity-100 transition-opacity duration-500 ease-out" />
    </button>
);
