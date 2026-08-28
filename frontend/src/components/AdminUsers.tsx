import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { api } from '../api';
import { ShieldCheck, ShieldAlert, KeyRound, LogOut } from 'lucide-react';

export const AdminUsers: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        role: 'user' as 'admin' | 'user' | 'depanneur'
    });
    const [formError, setFormError] = useState('');

    // "Réinitialiser 2FA" requires the ACTING admin's own password — a
    // small side prompt rather than a full modal, since it's a rare action.
    const [mfaResetTarget, setMfaResetTarget] = useState<User | null>(null);
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

    const handleOpenCreate = () => {
        setEditingUser(null);
        setFormData({ username: '', password: '', role: 'user' });
        setFormError('');
        setShowModal(true);
    };

    const handleOpenEdit = (user: User) => {
        setEditingUser(user);
        setFormData({ username: user.username, password: '', role: user.role });
        setFormError('');
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        if (!formData.username) {
            setFormError('Le nom est requis');
            return;
        }
        if (!editingUser && !formData.password) {
            setFormError('Un mot de passe initial est requis');
            return;
        }

        try {
            const payload: any = { username: formData.username, role: formData.role };
            if (formData.password) payload.password = formData.password;

            const res = editingUser
                ? await api.put(`/api/users/${editingUser.id}`, payload)
                : await api.post('/api/users', payload);

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Erreur lors de l\'enregistrement');
            }

            fetchUsers();
            setShowModal(false);
        } catch (err: any) {
            setFormError(err.message || "Erreur lors de l'enregistrement");
        }
    };

    const handleDelete = async (id: number) => {
        if (confirm('Supprimer définitivement cet utilisateur ?')) {
            const res = await api.delete(`/api/users/${id}`);
            if (res.ok) fetchUsers();
        }
    };

    const handleForceLogout = async (user: User) => {
        if (!confirm(`Déconnecter ${user.username} de partout ? Sa session en cours sera immédiatement invalidée.`)) return;
        const res = await api.post(`/api/users/${user.id}/force-logout`);
        if (!res.ok) {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Erreur');
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

    return (
        <div className="animate-in slide-in-from-left duration-300 p-6">
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
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                        </svg>
                        Backup BDD
                    </button>
                    <button
                        onClick={handleOpenCreate}
                        className="flex-1 sm:flex-none bg-ohm-primary text-ohm-bg font-black px-6 py-3 rounded-xl shadow-lg hover:bg-yellow-300 transition-all flex items-center justify-center gap-2 uppercase text-xs tracking-wider"
                    >
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" />
                        </svg>
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
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.map((user) => (
                                <tr key={user.id} className="text-sm hover:bg-slate-50/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-slate-900">{user.username}</span>
                                            {user.must_change_password && (
                                                <span className="text-[10px] text-amber-600 font-bold uppercase mt-0.5">Mot de passe temporaire</span>
                                            )}
                                        </div>
                                    </td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${user.role === 'admin'
                                                ? 'bg-ohm-primary/20 text-ohm-primary border border-ohm-primary/30'
                                                : user.role === 'depanneur'
                                                    ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
                                                    : 'bg-slate-100 text-slate-400'
                                            }`}>
                                            {user.role === 'admin' ? 'Admin' : user.role === 'depanneur' ? 'Dépanneur' : 'Employé'}
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
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleForceLogout(user)}
                                                className="p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all"
                                                title="Déconnecter de partout"
                                            >
                                                <LogOut className="w-5 h-5" />
                                            </button>
                                            {user.mfa_enabled && (
                                                <button
                                                    onClick={() => { setMfaResetTarget(user); setMfaResetPassword(''); setMfaResetError(''); }}
                                                    className="p-2 text-slate-500 hover:text-amber-500 hover:bg-amber-500/10 rounded-lg transition-all"
                                                    title="Réinitialiser la 2FA"
                                                >
                                                    <KeyRound className="w-5 h-5" />
                                                </button>
                                            )}
                                            <button
                                                onClick={() => handleOpenEdit(user)}
                                                className="p-2 text-slate-500 hover:text-ohm-primary hover:bg-ohm-primary/10 rounded-lg transition-all"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                                                </svg>
                                            </button>
                                            <button
                                                onClick={() => handleDelete(user.id)}
                                                className="p-2 rounded-lg transition-all text-red-400 hover:bg-red-500/10"
                                            >
                                                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                                                </svg>
                                            </button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showModal && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={() => setShowModal(false)}></div>
                    <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                        <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-between border-b border-slate-300">
                            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                                {editingUser ? 'Modifier' : 'Ajouter'} Collaborateur
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-slate-500 hover:text-slate-900">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Nom / Username</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">
                                    {editingUser ? 'Nouveau mot de passe (laisser vide pour ne pas changer)' : 'Mot de passe initial (12 caractères min.)'}
                                </label>
                                <input
                                    type="text"
                                    autoComplete="off"
                                    value={formData.password}
                                    onChange={(e) => setFormData({ ...formData, password: e.target.value })}
                                    className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 font-mono focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                                />
                                <p className="text-[10px] text-slate-400 mt-1.5">
                                    {editingUser
                                        ? "L'utilisateur devra en choisir un nouveau à sa prochaine connexion."
                                        : "Communiquez-le à l'utilisateur — il devra en choisir un nouveau à sa première connexion."}
                                </p>
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Rôle</label>
                                <AwesomeSelect
                                    value={formData.role}
                                    onChange={(val) => setFormData({ ...formData, role: val as 'user' | 'admin' | 'depanneur' })}
                                    options={[
                                        { value: 'user', label: 'Utilisateur' },
                                        { value: 'depanneur', label: 'Dépanneur' },
                                        { value: 'admin', label: 'Admin (2FA obligatoire)' }
                                    ]}
                                />
                            </div>
                            {formError && <p className="text-red-500 text-sm font-bold">{formError}</p>}
                            <button
                                type="submit"
                                className="w-full bg-ohm-primary text-ohm-bg font-black py-4 rounded-xl shadow-lg hover:bg-yellow-300 transition-all uppercase tracking-widest active:scale-95"
                            >
                                {editingUser ? 'Mettre à jour' : 'Enregistrer'}
                            </button>
                        </form>
                    </div>
                </div>
            )}

            {mfaResetTarget && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={() => setMfaResetTarget(null)}></div>
                    <form onSubmit={handleMfaReset} className="relative w-full max-w-sm bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl p-6 space-y-4 animate-in zoom-in duration-200">
                        <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                            Réinitialiser la 2FA de {mfaResetTarget.username}
                        </h3>
                        <p className="text-xs text-slate-500">
                            Confirmez avec VOTRE propre mot de passe. {mfaResetTarget.username} devra reconfigurer sa 2FA à sa prochaine connexion.
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
