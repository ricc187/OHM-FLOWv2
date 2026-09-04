import React, { useEffect, useState } from 'react';
import { Plus, Clock } from 'lucide-react';
import { User, Leave } from '../types';
import { LEAVE_TYPE_OPTIONS, LEAVE_TYPE_LABELS } from '../leaveTypes';
import { StatusBadge } from './StatusBadge';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { AwesomeDatePicker } from './ui/AwesomeDatePicker';
import { api } from '../api';

// Separate, standalone page (not a filter/tab inside the Agenda grid, per
// explicit decision) — "my own leave requests", same self-service shape
// Planning.tsx's old MY_LEAVES tab had. Creation goes through the same
// unified endpoint the Agenda form uses (POST /api/calendar/leaves) so the
// admin-auto-approve rule applies consistently regardless of which screen
// filed the request — always for just the current user here.
interface Props {
    currentUser: User;
}

export const MesConges: React.FC<Props> = ({ currentUser }) => {
    const [leaves, setLeaves] = useState<Leave[]>([]);
    const [showNew, setShowNew] = useState(false);
    const [form, setForm] = useState({ start_date: '', end_date: '', type: LEAVE_TYPE_OPTIONS[0].value as string });
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    const fetchLeaves = () => {
        api.get(`/api/leaves?user_id=${currentUser.id}`).then(res => res.ok && res.json()).then(data => data && setLeaves(data));
    };
    useEffect(fetchLeaves, [currentUser.id]);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.start_date || !form.end_date) { setError('Sélectionnez les dates.'); return; }
        if (form.end_date < form.start_date) { setError('La date de fin doit être après la date de début.'); return; }
        setError(null);
        setSaving(true);
        const res = await api.post('/api/calendar/leaves', {
            user_ids: [currentUser.id],
            type: form.type,
            date_debut: form.start_date,
            date_fin: form.end_date,
            toute_la_journee: true,
        });
        setSaving(false);
        if (res.ok) {
            setForm({ start_date: '', end_date: '', type: LEAVE_TYPE_OPTIONS[0].value });
            setShowNew(false);
            fetchLeaves();
        } else {
            const body = await res.json().catch(() => ({}));
            setError(body.error || 'Échec de la demande.');
        }
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div>
                <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                    <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Mes congés</span>
                </h2>
                <p className="text-slate-500 mt-1">Vos demandes d'absence — historique et statut</p>
            </div>

            <button
                onClick={() => setShowNew(!showNew)}
                className="w-full py-4 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-slate-900 hover:border-primary hover:bg-slate-50 transition-all flex items-center justify-center gap-2 font-bold uppercase tracking-widest"
            >
                <Plus /> Nouvelle demande
            </button>

            {showNew && (
                <div className="card border-l-4 border-l-primary animate-slide-up overflow-visible">
                    <form onSubmit={handleCreate} className="space-y-4">
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Début</label>
                                <AwesomeDatePicker value={form.start_date} onChange={d => setForm({ ...form, start_date: d, end_date: form.end_date && form.end_date < d ? d : form.end_date })} />
                            </div>
                            <div>
                                <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Fin</label>
                                <AwesomeDatePicker value={form.end_date} onChange={d => setForm({ ...form, end_date: d })} minDate={form.start_date} />
                            </div>
                        </div>
                        <div className="mt-4">
                            <label className="text-xs font-bold text-slate-400 uppercase mb-1 block">Type</label>
                            <AwesomeSelect value={form.type} onChange={v => setForm({ ...form, type: v })} options={LEAVE_TYPE_OPTIONS} />
                        </div>
                        {error && <p className="text-sm text-red-500 font-medium">{error}</p>}
                        <div className="flex justify-end gap-2">
                            <button type="button" onClick={() => setShowNew(false)} className="px-6 py-2 rounded-lg font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">ANNULER</button>
                            <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg font-bold bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
                                {saving ? 'ENVOI...' : 'ENVOYER'}
                            </button>
                        </div>
                    </form>
                </div>
            )}

            <div className="space-y-2">
                {leaves.map(l => (
                    <div key={l.id} className="card p-4 flex items-center justify-between">
                        <div>
                            <div className="font-bold text-slate-900 text-lg">{LEAVE_TYPE_LABELS[l.type] || l.type}</div>
                            <div className="text-sm text-slate-500 font-mono mt-1 flex items-center gap-2">
                                <span>{l.date_start}</span>
                                <span className="text-slate-400">→</span>
                                <span>{l.date_end}</span>
                            </div>
                            {l.admin_note && (
                                <div className="mt-2 text-xs italic text-slate-500 bg-slate-50 p-2 rounded border border-slate-200">
                                    <span className="font-bold text-primary mr-1">Note de l'admin:</span>
                                    {l.admin_note}
                                </div>
                            )}
                        </div>
                        <StatusBadge status={l.status} type="leave" />
                    </div>
                ))}
                {leaves.length === 0 && (
                    <div className="p-12 text-center text-slate-400 italic flex flex-col items-center border-2 border-dashed border-slate-200 rounded-xl">
                        <Clock size={48} className="opacity-20 mb-4" />
                        <p>Aucune demande de congé.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
