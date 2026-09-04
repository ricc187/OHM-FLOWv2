import React, { useEffect, useState } from 'react';
import { CalendarCheck, Check, X } from 'lucide-react';
import { Leave } from '../types';
import { LEAVE_TYPE_LABELS } from '../leaveTypes';
import { api } from '../api';

// Écran admin "Validation des congés" — comble le trou identifié : un
// employé qui crée sa propre demande (Mes congés) reste bloqué en
// status='PENDING' pour toujours, faute d'écran pour qu'un admin la traite.
// Branche uniquement sur l'existant (PUT /api/leaves/<id>/status,
// _approve_leave côté backend) — aucune nouvelle logique métier ici.
// GET /api/leaves n'a pas de filtre ?status= dédié (voir échange de cadrage) :
// une seule requête déjà existante, filtrée côté client — pas de N+1.

const formatDateRange = (l: Leave) => {
    if (l.date_start === l.date_end) return l.date_start;
    return `${l.date_start} → ${l.date_end}`;
};

export const AdminLeaves: React.FC = () => {
    const [leaves, setLeaves] = useState<Leave[]>([]);
    const [loading, setLoading] = useState(true);
    const [actingId, setActingId] = useState<number | null>(null);

    const fetchLeaves = () => {
        api.get('/api/leaves')
            .then(res => res.ok && res.json())
            .then((data: Leave[] | false) => {
                if (data) {
                    // id croissant = ordre de création (Leave n'a pas de created_at,
                    // voir échange de cadrage) — plus ancien en premier.
                    setLeaves(data.filter(l => l.status === 'PENDING').sort((a, b) => a.id - b.id));
                }
                setLoading(false);
            });
    };
    useEffect(fetchLeaves, []);

    const act = async (leave: Leave, status: 'APPROVED' | 'REJECTED') => {
        setActingId(leave.id);
        const res = await api.put(`/api/leaves/${leave.id}/status`, { status });
        setActingId(null);
        if (res.ok) {
            setLeaves(prev => prev.filter(l => l.id !== leave.id));
        } else {
            const body = await res.json().catch(() => ({}));
            alert(body.error || 'Échec de l\'opération.');
        }
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <CalendarCheck className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Validation des congés</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Demandes d'absence en attente d'approbation.</p>
                </div>
                <div className="bg-slate-50 px-4 py-2 rounded-lg text-slate-900 font-mono font-bold">
                    {leaves.length} en attente
                </div>
            </div>

            <div className="space-y-3">
                {leaves.map(l => (
                    <div key={l.id} className="p-4 rounded-2xl border border-slate-200 bg-white flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap">
                        <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-900 shrink-0">
                            {l.user_name?.[0]}
                        </div>
                        <div className="min-w-0 flex-1">
                            <div className="font-bold text-slate-900 truncate">{l.user_name}</div>
                            <div className="text-xs text-slate-500 truncate">
                                {LEAVE_TYPE_LABELS[l.type] || l.type} · {formatDateRange(l)} · {l.days_count} j
                            </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                            <button
                                onClick={() => act(l, 'REJECTED')}
                                disabled={actingId === l.id}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-red-500/10 text-red-500 hover:bg-red-500 hover:text-white transition-all font-bold text-sm disabled:opacity-50"
                            >
                                <X size={16} strokeWidth={3} /> Rejeter
                            </button>
                            <button
                                onClick={() => act(l, 'APPROVED')}
                                disabled={actingId === l.id}
                                className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all shadow-lg shadow-primary/20 font-bold text-sm disabled:opacity-50"
                            >
                                <Check size={18} strokeWidth={3} /> Approuver
                            </button>
                        </div>
                    </div>
                ))}

                {!loading && leaves.length === 0 && (
                    <div className="card p-12 text-center text-slate-400 italic flex flex-col items-center">
                        <Check size={48} className="opacity-20 mb-4" />
                        <p>Tout est à jour ! Aucun congé en attente.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
