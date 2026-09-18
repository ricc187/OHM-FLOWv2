import React, { useEffect, useRef, useState } from 'react';
import { User } from '../types';
import { api } from '../api';
import { ShieldCheck, ShieldAlert, KeyRound, Download, Plus } from 'lucide-react';
import { useMountTransition } from '../hooks/useMountTransition';
import { UserDetail } from './UserDetail';
import { UserFormModal } from './UserFormModal';

interface Props {
    currentUser: User;
}

export const AdminUsers: React.FC<Props> = ({ currentUser }) => {
    const [users, setUsers] = useState<User[]>([]);
    // Fiche détail — clic sur un username (voir la cellule nom dans la
    // table) bascule cette vue à la place de la liste, pas une modale :
    // assez de contenu (chantiers, absences) pour mériter son propre écran.
    // Reset mdp / modifier / force-logout / supprimer vivent maintenant sur
    // cette fiche (voir UserDetail.tsx), plus ici — seule la création
    // ("Ajouter") et le reset 2FA restent sur la liste.
    const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);

    // "Réinitialiser 2FA" requires the ACTING admin's own password — a
    // small side prompt rather than a full modal, since it's a rare action.
    const [mfaResetTarget, setMfaResetTarget] = useState<User | null>(null);
    const mfaModalT = useMountTransition(!!mfaResetTarget, 150);
    // Closing nulls mfaResetTarget immediately, but the modal stays mounted
    // ~150ms longer to play its close tween and still needs the username to
    // render during that window — cache the last non-null value for display.
    const mfaResetTargetRef = useRef<User | null>(null);
    if (mfaResetTarget) mfaResetTargetRef.current = mfaResetTarget;
    const mfaResetTargetDisplay = mfaResetTarget ?? mfaResetTargetRef.current;
    const [mfaResetPassword, setMfaResetPassword] = useState('');
    const [mfaResetError, setMfaResetError] = useState('');

    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await api.get('/api/users');
            if (res.ok) {
                setUsers(await res.json());
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        }
    };

    const handleMfaReset = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!mfaResetTarget) return;
        setMfaResetError('');
        const res = await api.post(`/api/mfa/admin-reset/${mfaResetTarget.id}`, { password: mfaResetPassword });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
            setMfaResetError(data.error || 'Erreur');
            return;
        }
        setMfaResetTarget(null);
        setMfaResetPassword('');
        fetchUsers();
    };

    const handleBackup = async () => {
        try {
            const res = await api.post('/api/backup');
            if (res.ok) {
                const blob = await res.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `backup_${new Date().toISOString().slice(0, 10)}.db`;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
            } else {
                alert('Erreur lors de la sauvegarde');
            }
        } catch (error) {
            console.error(error);
            alert('Erreur réseau');
        }
    };

    if (selectedUserId !== null) {
        return (
            <UserDetail
                userId={selectedUserId}
                currentUser={currentUser}
                onBack={() => setSelectedUserId(null)}
                onDeleted={() => { setSelectedUserId(null); fetchUsers(); }}
            />
        );
    }

    return (
        <div className="animate-fade-in p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 mb-8">
                <div>
                    <h1 className="text-3xl font-black text-slate-900 uppercase tracking-tighter">Équipe</h1>
                    <p className="text-slate-500 text-sm mt-1">Gestion des accès sécurisés</p>
                </div>
                <div className="flex gap-3">
                    <button
                        onClick={handleBackup}
                        className="flex-1 sm:flex-none bg-slate-100 text-slate-900 font-bold px-4 py-3 rounded-xl shadow-lg hover:bg-slate-200 transition-all flex items-center justify-center gap-2 uppercase text-xs tracking-wider"
                    >
                        <Download size={20} />
                        Backup BDD
                    </button>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="flex-1 sm:flex-none bg-ohm-primary text-ohm-bg font-black px-6 py-3 rounded-xl shadow-lg hover:bg-yellow-300 transition-all flex items-center justify-center gap-2 uppercase text-xs tracking-wider"
                    >
                        <Plus size={20} strokeWidth={3} />
                        Ajouter
                    </button>
                </div>
            </div>

            <div className="bg-ohm-surface border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[640px]">
                        <thead>
                            <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/50">
                                <th className="px-6 py-3">Nom / Username</th>
                                <th className="px-6 py-3">Rôle</th>
                                <th className="px-6 py-3">2FA</th>
                                <th className="px-6 py-3">Solde vacances</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.map((user) => (
                                <tr key={user.id} className="text-sm hover:bg-slate-50/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <button
                                                onClick={() => setSelectedUserId(user.id)}
                                                className="font-bold text-slate-900 hover:text-ohm-primary transition-colors text-left w-fit"
                                                title="Voir la fiche détail"
                                            >
                                                {user.username}
                                            </button>
                                            {user.must_change_password && (
                                                <span className="text-[10px] text-amber-600 font-bold uppercase mt-0.5">Mot de passe temporaire</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${user.role === 'admin'
                                                ? 'bg-ohm-primary/20 text-ohm-primary border border-ohm-primary/30'
                                                : user.role === 'depanneur'
                                                    ? 'bg-status-active/20 text-status-active border border-status-active/30'
                                                    : user.role === 'vehicule'
                                                        ? 'bg-amber-500/20 text-amber-600 border border-amber-500/30'
                                                        : 'bg-slate-100 text-slate-400'
                                            }`}>
                                            {user.role === 'admin' ? 'Admin' : user.role === 'depanneur' ? 'Dépanneur' : user.role === 'vehicule' ? 'Garagiste' : 'Employé'}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4">
                                        {!user.mfa_required ? (
                                            <span className="text-xs text-slate-400">—</span>
                                        ) : user.mfa_enabled ? (
                                            <span className="flex items-center gap-1.5 text-xs font-bold text-green-600">
                                                <ShieldCheck size={14} /> Activée
                                            </span>
                                        ) : (
                                            <span className="flex items-center gap-1.5 text-xs font-bold text-amber-600">
                                                <ShieldAlert size={14} /> Requise — pas encore configurée
                                            </span>
                                        )}
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className="text-sm font-bold text-slate-700">{user.vacation_balance ?? 0} j</span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            {user.mfa_enabled && (
                                                <button
                                                    onClick={() => { setMfaResetTarget(user); setMfaResetPassword(''); setMfaResetError(''); }}
                                                    className="p-2 text-slate-500 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all"
                                                    title="Réinitialiser la 2FA"
                                                >
                                                    <KeyRound className="w-5 h-5" />
                                                </button>
                                            )}
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            <UserFormModal
                show={showCreateModal}
                editingUser={null}
                onClose={() => setShowCreateModal(false)}
                onSaved={() => { fetchUsers(); setShowCreateModal(false); }}
            />

            {mfaModalT.mounted && mfaResetTargetDisplay && (
                <div className={`t-modal ${mfaModalT.active ? 'is-open' : 'is-closing'} fixed inset-0 z-[100] flex items-center justify-center p-4`}>
                    <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={() => setMfaResetTarget(null)}></div>
                    <form onSubmit={handleMfaReset} className="relative w-full max-w-sm bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl p-6 space-y-4">
                        <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                            Réinitialiser la 2FA de {mfaResetTargetDisplay.username}
                        </h3>
                        <p className="text-xs text-slate-500">
                            Confirmez avec VOTRE propre mot de passe. {mfaResetTargetDisplay.username} devra reconfigurer sa 2FA à sa prochaine connexion.
                        </p>
                        <input
                            type="password"
                            required
                            autoFocus
                            placeholder="Votre mot de passe"
                            value={mfaResetPassword}
                            onChange={(e) => setMfaResetPassword(e.target.value)}
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                        />
                        {mfaResetError && <p className="text-red-500 text-sm font-bold">{mfaResetError}</p>}
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setMfaResetTarget(null)} className="flex-1 py-3 rounded-xl bg-slate-100 text-slate-600 font-bold hover:bg-slate-200 transition-all">
                                Annuler
                            </button>
                            <button type="submit" className="flex-1 py-3 rounded-xl bg-ohm-primary text-ohm-bg font-black hover:bg-yellow-300 transition-all">
                                Confirmer
                            </button>
                        </div>
                    </form>
                </div>
            )}
        </div>
    );
};
