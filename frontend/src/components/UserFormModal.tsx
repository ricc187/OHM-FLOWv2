import React, { useEffect, useState } from 'react';
import { User } from '../types';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { api } from '../api';
import { useMountTransition } from '../hooks/useMountTransition';

interface Props {
    show: boolean;
    // null = mode création (AdminUsers.tsx, bouton "Ajouter") ; un User =
    // mode édition (UserDetail.tsx, bouton "Modifier" — nom/rôle/vacances,
    // + reset mdp optionnel ici aussi puisque le champ existait déjà, en
    // plus de l'action dédiée "Réinitialiser le mot de passe").
    editingUser: User | null;
    onClose: () => void;
    // Appelé après un enregistrement réussi — le formulaire ne se ferme pas
    // tout seul, c'est à onSaved (côté appelant) de refetch + fermer.
    onSaved: () => void;
}

// Formulaire création/édition d'utilisateur — un seul composant réutilisé
// par AdminUsers.tsx (création) et UserDetail.tsx (édition), pour ne pas
// dupliquer cette logique dans les deux écrans.
export const UserFormModal: React.FC<Props> = ({ show, editingUser, onClose, onSaved }) => {
    const modalT = useMountTransition(show, 150);
    const [formData, setFormData] = useState({
        username: '',
        password: '',
        role: 'user' as 'admin' | 'user' | 'depanneur' | 'vehicule',
        vacationBalance: '0',
    });
    const [formError, setFormError] = useState('');

    // Re-initialise le formulaire à chaque ouverture (création vide, ou
    // édition pré-remplie avec l'utilisateur ciblé) — remplace les anciens
    // handleOpenCreate/handleOpenEdit qui faisaient ça avant de monter la modale.
    useEffect(() => {
        if (!show) return;
        setFormData({
            username: editingUser?.username ?? '',
            password: '',
            role: editingUser?.role ?? 'user',
            vacationBalance: String(editingUser?.vacation_balance ?? 0),
        });
        setFormError('');
    }, [show, editingUser]);

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
        const vacationBalance = parseFloat(formData.vacationBalance.replace(',', '.'));
        if (isNaN(vacationBalance) || vacationBalance < 0) {
            setFormError('Solde de vacances invalide');
            return;
        }

        try {
            const payload: any = { username: formData.username, role: formData.role, vacation_balance: vacationBalance };
            if (formData.password) payload.password = formData.password;

            const res = editingUser
                ? await api.put(`/api/users/${editingUser.id}`, payload)
                : await api.post('/api/users', payload);

            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || 'Erreur lors de l\'enregistrement');
            }

            onSaved();
        } catch (err: any) {
            setFormError(err.message || "Erreur lors de l'enregistrement");
        }
    };

    if (!modalT.mounted) return null;

    return (
        <div className={`t-modal ${modalT.active ? 'is-open' : 'is-closing'} fixed inset-0 z-[100] flex items-center justify-center p-4`}>
            <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={onClose}></div>
            <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden">
                <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-between border-b border-slate-300">
                    <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                        {editingUser ? 'Modifier' : 'Ajouter'} Collaborateur
                    </h3>
                    <button onClick={onClose} className="text-slate-500 hover:text-slate-900">
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
                            onChange={(val) => setFormData({ ...formData, role: val as 'user' | 'admin' | 'depanneur' | 'vehicule' })}
                            options={[
                                { value: 'user', label: 'Utilisateur' },
                                { value: 'depanneur', label: 'Dépanneur' },
                                { value: 'vehicule', label: 'Garagiste (véhicules uniquement)' },
                                { value: 'admin', label: 'Admin (2FA obligatoire)' }
                            ]}
                        />
                    </div>
                    {formData.role !== 'vehicule' && (
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Solde de vacances (jours)</label>
                            <input
                                type="number"
                                min="0"
                                step="0.5"
                                required
                                value={formData.vacationBalance}
                                onChange={(e) => setFormData({ ...formData, vacationBalance: e.target.value })}
                                className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:ring-2 focus:ring-ohm-primary/50 transition-all outline-none"
                            />
                        </div>
                    )}
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
    );
};
