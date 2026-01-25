
import React, { useEffect, useState } from 'react';
import { User } from '../types';

export const AdminUsers: React.FC = () => {
    const [users, setUsers] = useState<User[]>([]);
    const [showModal, setShowModal] = useState(false);
    const [editingUser, setEditingUser] = useState<User | null>(null);
    const [formData, setFormData] = useState({
        username: '',
        pin: '',
        role: 'user' as 'admin' | 'user'
    });



    useEffect(() => {
        fetchUsers();
    }, []);

    const fetchUsers = async () => {
        try {
            const res = await fetch('/api/users');
            if (res.ok) {
                setUsers(await res.json());
            }
        } catch (error) {
            console.error("Failed to fetch users", error);
        }
    };

    const handleOpenCreate = () => {
        setEditingUser(null);
        setFormData({ username: '', pin: '', role: 'user' });
        setShowModal(true);
    };

    const handleOpenEdit = (user: User) => {
        setEditingUser(user);
        setFormData({ username: user.username, pin: user.pin || '', role: user.role });
        setShowModal(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!formData.username || formData.pin.length !== 6) {
            alert('Veuillez saisir un nom et un PIN de 6 chiffres');
            return;
        }

        try {
            if (editingUser) {
                const res = await fetch(`/api/users/${editingUser.id}`, {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                if (!res.ok) throw new Error('Update failed');
            } else {
                const res = await fetch('/api/users', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(formData)
                });
                if (!res.ok) throw new Error('Create failed');
            }

            fetchUsers();
            setShowModal(false);
        } catch (err) {
            alert("Erreur lors de l'enregistrement (Vérifiez si le nom existe déjà)");
        }
    };

    const handleDelete = async (id: number) => {
        if (confirm('Supprimer définitivement cet utilisateur ?')) {
            const res = await fetch(`/api/users/${id}`, { method: 'DELETE' });
            if (res.ok) fetchUsers();
        }
    };

    return (
        <div className="animate-in slide-in-from-left duration-300 p-6">
            <div className="flex items-center justify-between mb-8">
                <div>
                    <h1 className="text-3xl font-black text-ohm-text-main uppercase tracking-tighter">Équipe</h1>
                    <p className="text-ohm-text-muted text-sm mt-1">Gestion des accès sécurisés</p>
                </div>
                <button
                    onClick={handleOpenCreate}
                    className="bg-ohm-primary text-ohm-bg font-black px-6 py-3 rounded-xl shadow-lg hover:bg-yellow-300 transition-all flex items-center gap-2 uppercase text-xs tracking-wider"
                >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="3" d="M12 4v16m8-8H4" />
                    </svg>
                    Ajouter
                </button>
            </div>

            <div className="bg-ohm-surface border border-slate-800 rounded-2xl shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left">
                        <thead>
                            <tr className="text-[10px] font-black text-ohm-text-muted uppercase tracking-widest bg-slate-900/50">
                                <th className="px-6 py-3">Nom / Username</th>
                                <th className="px-6 py-3 text-center">Code PIN</th>
                                <th className="px-6 py-3">Rôle</th>
                                <th className="px-6 py-3 text-right">Actions</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800">
                            {users.map((user) => (
                                <tr key={user.id} className="text-sm hover:bg-slate-800/30 transition-colors">
                                    <td className="px-6 py-4">
                                        <div className="flex flex-col">
                                            <span className="font-bold text-ohm-text-main">{user.username}</span>
                                        </div>
                                    </td>
                                    <td className="px-6 py-4 text-center font-mono text-ohm-primary text-lg tracking-[0.2em]">{user.pin}</td>
                                    <td className="px-6 py-4">
                                        <span className={`text-[10px] font-black uppercase px-2 py-0.5 rounded ${user.role === 'admin' ? 'bg-ohm-primary/20 text-ohm-primary border border-ohm-primary/30' : 'bg-slate-700 text-slate-400'
                                            }`}>
                                            {user.role}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-right">
                                        <div className="flex items-center justify-end gap-2">
                                            <button
                                                onClick={() => handleOpenEdit(user)}
                                                className="p-2 text-ohm-text-muted hover:text-ohm-primary hover:bg-ohm-primary/10 rounded-lg transition-all"
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
                    <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-700 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                        <div className="bg-slate-800/80 px-6 py-4 flex items-center justify-between border-b border-slate-700">
                            <h3 className="font-black text-ohm-text-main uppercase tracking-widest text-sm">
                                {editingUser ? 'Modifier' : 'Ajouter'} Collaborateur
                            </h3>
                            <button onClick={() => setShowModal(false)} className="text-ohm-text-muted hover:text-ohm-text-main">
                                <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                                </svg>
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-6">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-ohm-text-muted mb-2 tracking-widest">Nom / Username</label>
                                <input
                                    type="text"
                                    required
                                    value={formData.username}
                                    onChange={(e) => setFormData({ ...formData, username: e.target.value })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-ohm-text-main focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-ohm-text-muted mb-2 tracking-widest">Code PIN (6 chiffres)</label>
                                <input
                                    type="text"
                                    required
                                    maxLength={6}
                                    value={formData.pin}
                                    onChange={(e) => setFormData({ ...formData, pin: e.target.value.replace(/\D/g, '') })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-ohm-text-main text-center text-xl font-black tracking-[0.5em] focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-ohm-text-muted mb-2 tracking-widest">Rôle</label>
                                <select
                                    value={formData.role}
                                    onChange={(e) => setFormData({ ...formData, role: e.target.value as 'user' | 'admin' })}
                                    className="w-full bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 text-ohm-text-main focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                                >
                                    <option value="user">Ouvrier/Employé</option>
                                    <option value="admin">Administrateur</option>
                                </select>
                            </div>
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
        </div>
    );
};
