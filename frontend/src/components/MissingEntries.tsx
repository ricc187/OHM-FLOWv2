import React, { useEffect, useState } from 'react';
import { AlertTriangle, Check, X } from 'lucide-react';
import { api } from '../api';

// Écran admin "Heures non entrées" — employés avec une chantier_assignment
// confirmée un jour donné, sans Entry ce jour-là ni Leave approuvée le
// couvrant (voir GET /api/admin/missing-entries, backend/app.py). Une
// anomalie reste dans la liste tant qu'elle n'est pas acquittée — même
// pattern que "Validation Saisies" pour le style, formulaire "raison"
// optionnel inline plutôt qu'une modale séparée.

interface AnomalyChantier { id: number; nom: string; }
interface Anomaly { user_id: number; user_name: string; date: string; chantiers: AnomalyChantier[]; }

const formatDate = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const label = d.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    return label.charAt(0).toUpperCase() + label.slice(1);
};

const anomalyKey = (a: Anomaly) => `${a.user_id}|${a.date}`;

export const MissingEntries: React.FC = () => {
    const [anomalies, setAnomalies] = useState<Anomaly[]>([]);
    const [loading, setLoading] = useState(true);
    // Ligne en cours d'acquittement (formulaire "raison" ouvert inline).
    const [ackingKey, setAckingKey] = useState<string | null>(null);
    const [reason, setReason] = useState('');
    const [saving, setSaving] = useState(false);

    const fetchAnomalies = () => {
        api.get('/api/admin/missing-entries')
            .then(res => res.ok && res.json())
            .then((data: { anomalies: Anomaly[] } | false) => {
                if (data) setAnomalies(data.anomalies); // déjà triées par date croissante côté backend
                setLoading(false);
            });
    };
    useEffect(fetchAnomalies, []);

    const startAck = (a: Anomaly) => {
        setAckingKey(anomalyKey(a));
        setReason('');
    };

    const cancelAck = () => {
        setAckingKey(null);
        setReason('');
    };

    const confirmAck = async (a: Anomaly) => {
        setSaving(true);
        const res = await api.post('/api/admin/missing-entries/acknowledge', {
            user_id: a.user_id, date: a.date, reason: reason.trim() || undefined,
        });
        setSaving(false);
        if (res.ok) {
            setAnomalies(prev => prev.filter(x => anomalyKey(x) !== anomalyKey(a)));
            setAckingKey(null);
            setReason('');
        } else {
            const body = await res.json().catch(() => ({}));
            alert(body.error || "Échec de l'acquittement.");
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <AlertTriangle className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Heures non entrées</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Affectation planifiée sans saisie ni absence approuvée ce jour-là.</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-lg text-slate-900 font-mono font-bold">
                    {anomalies.length} en attente
                </div>
            </div>

            <div className="space-y-3">
                {anomalies.map(a => {
                    const key = anomalyKey(a);
                    const isAcking = ackingKey === key;
                    return (
                        <div key={key} className={`p-4 rounded-2xl border transition-all ${isAcking ? 'border-ohm-primary ring-2 ring-ohm-primary/30 bg-ohm-primary/5' : 'border-slate-200 bg-white'}`}>
                            <div className="flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
                                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-900 shrink-0">
                                    {a.user_name?.[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-900 truncate">{a.user_name}</div>
                                    <div className="text-xs text-slate-500 truncate">
                                        {formatDate(a.date)} · {a.chantiers.length > 0 ? a.chantiers.map(c => c.nom).join(', ') : 'Chantier inconnu'}
                                    </div>
                                </div>

                                {!isAcking && (
                                    <button
                                        onClick={() => startAck(a)}
                                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all shadow-lg shadow-primary/20 font-bold text-sm shrink-0"
                                    >
                                        <Check size={18} strokeWidth={3} /> Acquitter
                                    </button>
                                )}
                            </div>

                            {isAcking && (
                                <div className="mt-3 pt-3 border-t border-slate-100 flex items-start gap-2 flex-wrap sm:flex-nowrap">
                                    <input
                                        type="text"
                                        className="input-field flex-1 min-w-[200px]"
                                        placeholder="Raison (optionnel) — ex : régularisé oralement, oubli ponctuel…"
                                        value={reason}
                                        onChange={e => setReason(e.target.value)}
                                        autoFocus
                                        onKeyDown={e => { if (e.key === 'Enter') confirmAck(a); if (e.key === 'Escape') cancelAck(); }}
                                    />
                                    <div className="flex items-center gap-2 shrink-0">
                                        <button onClick={cancelAck} className="p-2.5 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 transition-all" title="Annuler">
                                            <X size={18} />
                                        </button>
                                        <button
                                            onClick={() => confirmAck(a)}
                                            disabled={saving}
                                            className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all font-bold text-sm disabled:opacity-50"
                                        >
                                            <Check size={16} strokeWidth={3} /> Confirmer
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}

                {!loading && anomalies.length === 0 && (
                    <div className="card p-12 text-center text-slate-400 italic flex flex-col items-center">
                        <Check size={48} className="opacity-20 mb-4" />
                        <p>Tout est à jour ! Aucune anomalie en attente.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
