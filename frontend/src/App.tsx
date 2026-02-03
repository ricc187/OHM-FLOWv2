import { useState } from 'react';
import { User, Chantier } from './types.ts';
import { Dashboard } from './components/Dashboard';
import { ChantierDetail } from './components/ChantierDetail';
import { AdminUsers } from './components/AdminUsers';
import { AdminEntries } from './components/AdminEntries';
import { Planning } from './components/Planning';
import { GlobalStats } from './components/GlobalStats';
import { Login } from './components/Login';
import { Layout } from './components/Layout';

function App() {
    const [user, setUser] = useState<User | null>(null);
    const [view, setView] = useState<'dashboard' | 'admin' | 'detail' | 'admin-entries' | 'planning' | 'stats'>('dashboard');
    const [selectedChantier, setSelectedChantier] = useState<Chantier | null>(null);

    const handleLogin = async (pin: string) => {
        try {
            const res = await fetch('/api/login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin })
            });
            if (res.ok) {
                const userData = await res.json();
                setUser(userData);
            } else {
                alert('Invalid PIN');
            }
        } catch (err) {
            console.error(err);
            alert('Connection error');
        }
    };

    const handleLogout = () => {
        setUser(null);
        setView('dashboard');
        setSelectedChantier(null);
    };

    const handleNavigate = (path: string) => {
        setSelectedChantier(null);
        if (path === 'dashboard') setView('dashboard');
        else if (path === 'admin-users') setView('admin');
        else if (path === 'admin-entries') setView('admin-entries');
        else if (path === 'planning') setView('planning');
        else if (path === 'stats') setView('stats');
    };

    if (!user) {
        return <Login onLogin={handleLogin} />;
    }

    return (
        <Layout
            user={user}
            onLogout={handleLogout}
            onNavigate={handleNavigate}
        >
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
                    onBack={() => setSelectedChantier(null)}
                />
            ) : (
                <Dashboard
                    currentUser={user}
                    onSelectChantier={(c) => setSelectedChantier(c)}
                />
            )}
        </Layout>
    );
}

export default App;
