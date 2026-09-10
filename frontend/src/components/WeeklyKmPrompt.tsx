import React, { useState } from 'react';
import { api } from '../api';

interface Props {
    // Renvoie pending_km_entry tel que répondu par le serveur — App.tsx
    // décide seul de la suite (fermer, ou basculer en mode bloqué + rediriger
    // vers Véhicules). Ce composant ne fait que poser la question.
    onAnswered: (pendingKmEntry: boolean) => void;
}

// Non-fermable par design (voir prompt initial, section 5) : pas de croix,
// pas de fermeture au clic sur le fond, et surtout aucun handler Escape —
// même style que NoticeBanner.tsx (fixed inset-0 + backdrop-blur), mais un
// z-index plus élevé (300 > 200) pour passer devant si une annonce admin
// est aussi en attente au même moment — cas limite non couvert par le
// prompt, tranché ici plutôt que de superposer deux popups non-fermables.
export const WeeklyKmPrompt: React.FC<Props> = ({ onAnswered }) => {
    const [busy, setBusy] = useState<'oui' | 'non' | null>(null);
    const [error, setError] = useState('');

    const respond = async (reponse: 'oui' | 'non') => {
        setBusy(reponse);
        setError('');
        try {
            const res = await api.post('/api/weekly-km-prompt/respond', { reponse });
            if (res.ok) {
                const data = await res.json();
                onAnswered(!!data.pending_km_entry);
            } else {
                const data = await res.json().catch(() => ({}));
                setError(data.error || 'Erreur réseau — réessayez');
                setBusy(null);
            }
        } catch {
            setError('Erreur réseau — réessayez');
            setBusy(null);
        }
    };

    return (
        <div className="fixed inset-0 z-[300] flex items-center justify-center bg-white/80 backdrop-blur-md p-4 safe-top safe-bottom">
            <div className="w-full max-w-md bg-white rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-fade-in p-6 space-y-5">
                <div>
                    <h2 className="text-lg font-black text-slate-900">Relevé kilométrique hebdomadaire</h2>
                    <p className="text-slate-500 text-sm mt-2">
                        Avez-vous conduit un véhicule de l'entreprise aujourd'hui ?
                    </p>
                </div>
                {error && <p className="text-red-500 text-sm font-bold">{error}</p>}
                <div className="flex gap-3">
                    <button
                        onClick={() => respond('non')}
                        disabled={busy !== null}
                        className="flex-1 py-3.5 bg-slate-100 text-slate-700 font-black rounded-xl hover:bg-slate-200 transition-all uppercase tracking-widest disabled:opacity-50"
                    >
                        {busy === 'non' ? '…' : 'Non'}
                    </button>
                    <button
                        onClick={() => respond('oui')}
                        disabled={busy !== null}
                        className="flex-1 py-3.5 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all uppercase tracking-widest disabled:opacity-50"
                    >
                        {busy === 'oui' ? '…' : 'Oui'}
                    </button>
                </div>
            </div>
        </div>
    );
};
