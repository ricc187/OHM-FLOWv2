import React, { useEffect, useState } from 'react';
import { AdminNotice } from '../types';
import { Megaphone, Plus, Trash2, Power } from 'lucide-react';
import { api } from '../api';

const todayStr = new Date().toISOString().split('T')[0];

export const AdminNotices: React.FC = () => {
    const [notices, setNotices] = useState<AdminNotice[]>([]);
    const [loading, setLoading] = useState(true);
    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState({ message: '', date_start: todayStr, duration_days: '7' });
    const [submitting, setSubmitting] = useState(false);

    const fetchNotices = async () => {
        const res = await api.get('/api/notices');
        if (res.ok) setNotices(await res.json());
        setLoading(false);
    };

    useEffect(() => { fetchNotices(); }, []);

    const handleCreate = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!form.message.trim()) return;
        setSubmitting(true);
        try {
            const res = await api.post('/api/notices', {
                message: form.message.trim(),
                date_start: form.date_start,
                duration_days: parseInt(form.duration_days, 10) || 7
            });
            if (res.ok) {
                setForm({ message: '', date_start: todayStr, duration_days: '7' });
                setShowCreate(false);
                fetchNotices();
            } else {
                const data = await res.json().catch(() => ({}));
                alert(data.error || 'Erreur lors de la création');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleToggleActive = async (n: AdminNotice) => {
        const res = await api.put(`/api/notices/${n.id}`, { active: !n.active });
        if (res.ok) fetchNotices();
    };

    const handleDelete = async (n: AdminNotice) => {
        if (!confirm('Supprimer cette annonce ?')) return;
        const res = await api.delete(`/api/notices/${n.id}`);
        if (res.ok) fetchNotices();
    };

    const windowEnd = (n: AdminNotice) => {
        const d = new Date(n.date_start + 'T00:00:00');
        d.setDate(d.getDate() + n.duration_days);
        return d.toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' });
    };

    const isExpired = (n: AdminNotice) => {
        const d = new Date(n.date_start + 'T00:00:00');
        d.setDate(d.getDate() + n.duration_days);
        return d < new Date(new Date().toISOString().split('T')[0] + 'T00:00:00');
    };

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Megaphone className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Annonces</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Message affiché à tous les utilisateurs à l'ouverture de l'app, jusqu'à ce qu'ils cliquent "J'ai pris note".</p>
                </div>
                <button
                    onClick={() => setShowCreate(v => !v)}
                    className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all font-bold text-sm"
                >
                    <Plus size={16} /> Nouvelle annonce
                </button>
            </div>

            {showCreate && (
                <form onSubmit={handleCreate} className="card p-4 sm:p-6 space-y-4 border border-slate-200 bg-slate-50/60 animate-fade-in">
                    <div>
                        <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Message</label>
                        <textarea
                            autoFocus
                            className="input-field min-h-[80px]"
                            value={form.message}
                            onChange={e => setForm({ ...form, message: e.target.value })}
                            placeholder="Ex: L'échelle est à gauche de l'atelier"
                            required
                        />
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Date de début</label>
                            <input
                                type="date"
                                className="input-field"
                                value={form.date_start}
                                onChange={e => setForm({ ...form, date_start: e.target.value })}
                            />
                        </div>
                        <div>
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-2 block">Durée (jours)</label>
                            <input
                                type="number" min={1}
                                className="input-field"
                                value={form.duration_days}
                                onChange={e => setForm({ ...form, duration_days: e.target.value })}
                            />
                        </div>
                    </div>
                    <div className="flex justify-end gap-2">
                        <button type="button" onClick={() => setShowCreate(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all text-sm font-bold">
                            Annuler
                        </button>
                        <button type="submit" disabled={submitting} className="px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all text-sm font-bold disabled:opacity-50">
                            Publier
                        </button>
                    </div>
                </form>
            )}

            <div className="space-y-3">
                {!loading && notices.length === 0 && (
                    <div className="card p-12 text-center text-slate-400 italic">
                        Aucune annonce pour l'instant.
                    </div>
                )}
                {notices.map(n => {
                    const expired = isExpired(n);
                    return (
                        <div key={n.id} className={`card p-4 flex items-start gap-3 ${!n.active || expired ? 'opacity-50' : ''}`}>
                            <div className="min-w-0 flex-1">
                                <div className="text-slate-900 font-medium whitespace-pre-wrap">{n.message}</div>
                                <div className="text-xs text-slate-400 mt-1">
                                    Du {new Date(n.date_start + 'T00:00:00').toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' })} au {windowEnd(n)}
                                    {' · '}par {n.created_by || '—'}
                                    {!n.active && ' · désactivée'}
                                    {n.active && expired && ' · expirée'}
                                </div>
                            </div>
                            <div className="flex items-center gap-1 shrink-0">
                                <button
                                    onClick={() => handleToggleActive(n)}
                                    className={`p-2 rounded-lg transition-all ${n.active ? 'bg-slate-50 text-slate-500 hover:bg-slate-100' : 'bg-green-500/10 text-green-600 hover:bg-green-500 hover:text-white'}`}
                                    title={n.active ? 'Désactiver' : 'Réactiver'}
                                >
                                    <Power size={16} />
                                </button>
                                <button
                                    onClick={() => handleDelete(n)}
                                    className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                    title="Supprimer"
                                >
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>
        </div>
    );
};
