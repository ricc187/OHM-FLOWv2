import React, { useState } from 'react';
import { User } from '../types';
import { api } from '../api';
import { KeyRound } from 'lucide-react';

interface Props {
    user: User;
    onChanged: (user: User) => void;
}

// Blocks the app until a temp/admin-reset password is replaced. Shown
// whenever user.must_change_password is true — set on account creation,
// on an admin-triggered password reset, and on the one-time PIN-login
// retirement migration.
export const ChangePasswordGate: React.FC<Props> = ({ user, onChanged }) => {
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmPassword, setConfirmPassword] = useState('');
    const [error, setError] = useState('');
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError('');
        if (newPassword !== confirmPassword) {
            setError('Les deux mots de passe ne correspondent pas');
            return;
        }
        setBusy(true);
        try {
            const res = await api.post('/api/change-password', { current_password: currentPassword, new_password: newPassword });
            const data = await res.json();
            if (!res.ok) throw new Error(data.error || 'Erreur');
            onChanged({ ...user, must_change_password: false });
        } catch (err: any) {
            setError(err.message || 'Erreur réseau');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="h-[100dvh] flex items-center justify-center p-4 bg-ohm-bg safe-top safe-bottom safe-left safe-right">
            <form onSubmit={submit} className="card w-full max-w-sm space-y-5">
                <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl bg-ohm-primary/15 flex items-center justify-center shrink-0">
                        <KeyRound className="text-ohm-primary" size={22} />
                    </div>
                    <div>
                        <h1 className="text-lg font-black text-slate-900">Nouveau mot de passe requis</h1>
                        <p className="text-slate-500 text-xs">Choisissez un mot de passe définitif avant de continuer</p>
                    </div>
                </div>

                <label className="block">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Mot de passe actuel / temporaire</span>
                    <input type="password" required autoFocus autoComplete="current-password" className="input-field"
                        value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} />
                </label>

                <label className="block">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Nouveau mot de passe (12 caractères min.)</span>
                    <input type="password" required autoComplete="new-password" className="input-field"
                        value={newPassword} onChange={e => setNewPassword(e.target.value)} />
                </label>

                <label className="block">
                    <span className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Confirmer le nouveau mot de passe</span>
                    <div className={`t-input-wrap ${error ? 'is-error' : ''}`}>
                        <input type="password" required autoComplete="new-password" className={`t-input input-field ${error ? 'is-shaking' : ''}`}
                            value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} />
                        <p className="t-error-msg text-red-500 text-sm font-bold mt-1">{error}</p>
                    </div>
                </label>

                <button type="submit" disabled={busy} className="w-full py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest disabled:opacity-50">
                    {busy ? 'Enregistrement…' : 'Enregistrer et continuer'}
                </button>
            </form>
        </div>
    );
};
