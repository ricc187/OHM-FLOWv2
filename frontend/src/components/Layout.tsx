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
        <div className="flex min-h-screen bg-ohm-bg">
            {/* Sidebar */}
            <aside className="fixed left-0 top-0 z-50 h-screen w-20 hover:w-64 bg-ohm-surface/95 backdrop-blur-md border-r border-slate-800 shadow-2xl transition-all duration-300 group flex flex-col overflow-hidden">

                {/* Logo Area */}
                <div className="h-20 flex items-center justify-start border-b border-white/5 transition-all w-full overflow-hidden shrink-0">
                    <button onClick={() => onNavigate('dashboard')} className="flex items-center w-full h-full px-4 group-hover:px-6 transition-all duration-300">
                        {/* Fixed width container for icon */}
                        <div className="w-12 h-12 flex items-center justify-center flex-shrink-0">
                            <OhmIcon />
                        </div>
                        {/* Text Container with Width Transition */}
                        <div className="w-0 overflow-hidden group-hover:w-40 transition-all duration-500 ease-in-out flex flex-col justify-center ml-0 group-hover:ml-4">
                            <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-100 font-extrabold text-2xl tracking-tighter text-white whitespace-nowrap">
                                OHM<span className="text-ohm-primary">FLOW</span>
                            </span>
                        </div>
                    </button>
                </div>

                {/* Navigation Items */}
                <nav className="flex-1 py-8 px-3 space-y-2 flex flex-col items-center group-hover:items-stretch">

                    <NavItem
                        icon={<LayoutDashboard size={24} />}
                        label="Tableau de bord"
                        onClick={() => onNavigate('dashboard')}
                    />

                    <NavItem
                        icon={<Calendar size={24} />}
                        label="Planning & Congés"
                        onClick={() => onNavigate('planning')}
                    />

                    {user?.role === 'admin' && (
                        <>
                            <div className="w-full h-px bg-white/10 my-4" />
                            <div className="hidden group-hover:block px-4 text-[10px] font-bold text-gray-500 uppercase tracking-widest mb-2 animate-fade-in delay-200">
                                Administration
                            </div>

                            <NavItem
                                icon={<BarChart3 size={24} />}
                                label="Statistiques"
                                onClick={() => onNavigate('stats')}
                            />

                            <NavItem
                                icon={<Users size={24} />}
                                label="Gestion Utilisateurs"
                                onClick={() => onNavigate('admin-users')}
                            />

                            <NavItem
                                icon={<ClipboardCheck size={24} />}
                                label="Validation Saisies"
                                onClick={() => onNavigate('admin-entries')}
                            />
                        </>
                    )}

                </nav>

                {/* User & Logout */}
                <div className="p-4 border-t border-white/5 bg-black/20 mt-auto">
                    <div className="flex items-center gap-3 min-w-max">
                        <div className="w-10 h-10 rounded-full bg-gradient-to-br from-ohm-primary to-yellow-600 flex items-center justify-center font-bold text-ohm-bg shadow-lg shrink-0">
                            {user?.username?.[0].toUpperCase() || 'G'}
                        </div>
                        <div className="w-0 overflow-hidden group-hover:w-32 transition-all duration-300 flex flex-col justify-center">
                            <div className="font-bold text-white text-sm truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75">{user?.username || 'Guest'}</div>
                            <div className="text-[10px] uppercase text-ohm-primary font-bold tracking-wider truncate opacity-0 group-hover:opacity-100 transition-opacity duration-300 delay-75">{user?.role || 'Visiteur'}</div>
                        </div>
                        <button
                            onClick={onLogout}
                            className="p-2 rounded-lg hover:bg-red-500/10 text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 duration-300 ml-auto"
                            title="Déconnexion"
                        >
                            <LogOut size={20} />
                        </button>
                    </div>
                </div>

            </aside>

            {/* Main Content Area */}
            <main className="flex-1 ml-20 transition-all duration-300 p-8 w-full max-w-[1600px]">
                {children}
            </main>
        </div>
    );
};

// Helper Component for Nav Items
const NavItem = ({ icon, label, onClick }: { icon: React.ReactNode, label: string, onClick: () => void }) => (
    <button
        onClick={onClick}
        className="w-full h-12 flex items-center gap-4 px-3 rounded-xl text-gray-400 hover:text-white hover:bg-white/5 transition-all group/item relative overflow-hidden"
    >
        <div className="w-8 flex justify-center flex-shrink-0">
            {icon}
        </div>
        <span className="opacity-0 group-hover:opacity-100 transition-opacity duration-300 font-bold text-sm whitespace-nowrap delay-75">
            {label}
        </span>
    </button>
);
