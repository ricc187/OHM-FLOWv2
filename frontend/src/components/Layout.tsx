
import React from 'react';
import { Logo } from './Icons';

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
        <div className="min-h-screen bg-ohm-bg flex flex-col">
            <header className="sticky top-0 z-50 bg-ohm-surface/80 backdrop-blur-md border-b border-slate-800 px-4 py-3 shadow-lg">
                <div className="max-w-6xl mx-auto flex items-center justify-between">
                    <button onClick={() => onNavigate('dashboard')} className="hover:opacity-80 transition-opacity">
                        <Logo />
                    </button>
                    <button onClick={() => onNavigate('planning')} className="ml-4 md:ml-8 text-sm font-bold text-gray-400 hover:text-white transition-colors uppercase tracking-widest flex items-center gap-2">
                        <span className="hidden md:inline">Planning & Congés</span>
                        <span className="md:hidden">Planning</span>
                    </button>

                    <div className="flex items-center gap-3 md:gap-6">
                        <div className="hidden md:flex flex-col items-end">
                            <span className="text-sm font-semibold text-ohm-text-main">{user?.username || 'Guest'}</span>
                            <span className="text-[10px] uppercase tracking-widest text-ohm-primary">{user?.role || 'Visitor'}</span>
                        </div>

                        <div className="flex items-center gap-2">
                            {user?.role === 'admin' && (
                                <>
                                    <button
                                        onClick={() => onNavigate('admin-users')}
                                        className="p-2 bg-slate-800 rounded-lg hover:bg-slate-700 transition-colors text-xs font-bold text-gray-400 hover:text-white flex items-center gap-2"
                                    >
                                        <span className="md:hidden">USR</span>
                                        <span className="hidden md:inline">GESTION USERS</span>
                                    </button>
                                    <button
                                        onClick={() => onNavigate('admin-entries')}
                                        className="p-2 bg-slate-700 rounded-lg hover:bg-slate-600 transition-colors text-xs font-bold text-ohm-text-main flex items-center gap-2"
                                    >
                                        <span className="md:hidden">VAL</span>
                                        <span className="hidden md:inline">VALIDATION SAISIES</span>
                                    </button>
                                </>
                            )}
                            <button
                                onClick={onLogout}
                                className="p-2 text-red-400 hover:text-red-300 transition-colors"
                                title="Déconnexion"
                            >
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
                                </svg>
                            </button>
                        </div>
                    </div>
                </div>
            </header>

            <main className="flex-1 w-full max-w-6xl mx-auto p-4 md:p-8">
                {children}
            </main>
        </div>
    );
};
