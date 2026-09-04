import React, { useEffect, useState } from 'react';
import { CalendarRange, Plus, Download, X, Loader2 } from 'lucide-react';
import { ChantierPrevision, PrevisionImportResult, User } from '../types';
import { api } from '../api';
import { StatusBadge } from './StatusBadge';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { PrevisionTimeline } from './PrevisionTimeline';

// Module de prévision annuelle — TOTALEMENT INDÉPENDANT de l'Agenda et des
// chantier_assignments : ne lit/écrit que /api/prevision*. Isolé de toute
// nav pour l'instant (voir consigne étape 2) — composant testable seul.

const formatCHF = (v: number | null | undefined) =>
    v == null ? '—' : `${v.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;

const formatDate = (d: string | null | undefined) =>
    d ? new Date(d + 'T00:00:00').toLocaleDateString('fr-CH', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

const emptyForm = {
    nom: '',
    referent_id: '' as string, // '' = aucun référent — AwesomeSelect works on strings
    montant_estime: '' as string,
    date_debut_theorique: '',
    date_fin_theorique: '',
};

export const PrevisionAnnuelle: React.FC = () => {
    const [items, setItems] = useState<ChantierPrevision[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [loading, setLoading] = useState(true);
    const [importing, setImporting] = useState(false);
    const [message, setMessage] = useState<{ kind: 'success' | 'error'; text: string } | null>(null);

    const [showCreate, setShowCreate] = useState(false);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const fetchList = async () => {
        const res = await api.get('/api/prevision');
        if (res.ok) setItems(await res.json());
        setLoading(false);
    };

    useEffect(() => {
        fetchList();
        api.get('/api/users').then(res => res.ok && res.json()).then(data => data && setUsers(data));
    }, []);

    const handleImport = async () => {
        setImporting(true);
        setMessage(null);
        try {
            const res = await api.post('/api/prevision/import');
            const data: PrevisionImportResult | { error?: string } = await res.json().catch(() => ({}));
            if (res.ok) {
                const { created_count, already_imported_count } = data as PrevisionImportResult;
                setMessage({
                    kind: 'success',
                    text: `${created_count} chantier(s) importé(s) — ${already_imported_count} déjà présent(s) dans la prévision.`,
                });
                fetchList();
            } else {
                setMessage({ kind: 'error', text: (data as { error?: string }).error || "Échec de l'import" });
            }
        } finally {
            setImporting(false);
        }
    };

    const handleOpenCreate = () => {
        setForm(emptyForm);
        setFormError('');
        setShowCreate(true);
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        if (!form.nom.trim()) {
            setFormError('Le nom est requis');
            return;
        }
        if (form.montant_estime && (isNaN(Number(form.montant_estime)) || Number(form.montant_estime) < 0)) {
            setFormError('Montant estimé invalide');
            return;
        }
        if (form.date_debut_theorique && form.date_fin_theorique && form.date_debut_theorique > form.date_fin_theorique) {
            setFormError('La date de fin théorique doit être après la date de début');
            return;
        }

        setSubmitting(true);
        try {
            const payload: Record<string, unknown> = {
                nom: form.nom.trim(),
                statut: 'prevu',
                referent_id: form.referent_id ? Number(form.referent_id) : null,
                montant_estime: form.montant_estime ? Number(form.montant_estime) : null,
                date_debut_theorique: form.date_debut_theorique || null,
                date_fin_theorique: form.date_fin_theorique || null,
            };
            const res = await api.post('/api/prevision', payload);
            if (res.ok) {
                setShowCreate(false);
                setForm(emptyForm);
                fetchList();
            } else {
                const data = await res.json().catch(() => ({}));
                setFormError(data.error || 'Erreur lors de la création');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const referentOptions = [
        { value: '', label: 'Aucun référent' },
        ...users.map(u => ({ value: String(u.id), label: u.username })),
    ];

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <CalendarRange className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Prévision annuelle</span>
                    </h2>
                    <p className="text-slate-500 mt-1">
                        Chantiers "prévus" (pas encore créés) et chantiers réels "confirmés" — vue indépendante de l'Agenda, pour anticiper l'activité de l'année.
                    </p>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleImport}
                        disabled={importing}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all font-bold text-sm disabled:opacity-50"
                    >
                        {importing ? <Loader2 size={16} className="animate-spin" /> : <Download size={16} />}
                        Importer les chantiers existants
                    </button>
                    <button
                        onClick={handleOpenCreate}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all font-bold text-sm"
                    >
                        <Plus size={16} /> Chantier à venir
                    </button>
                </div>
            </div>

            {message && (
                <div className={`card p-4 flex items-start justify-between gap-3 ${message.kind === 'success' ? 'border-emerald-300 bg-emerald-50/60' : 'border-red-300 bg-red-50/60'}`}>
                    <p className={`text-sm font-medium ${message.kind === 'success' ? 'text-emerald-700' : 'text-red-600'}`}>{message.text}</p>
                    <button onClick={() => setMessage(null)} className="text-slate-400 hover:text-slate-700 shrink-0">
                        <X size={16} />
                    </button>
                </div>
            )}

            <PrevisionTimeline items={items} setItems={setItems} onError={text => setMessage({ kind: 'error', text })} />

            <div className="bg-ohm-surface border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <table className="w-full text-left min-w-[720px]">
                        <thead>
                            <tr className="text-[10px] font-black text-slate-500 uppercase tracking-widest bg-white/50">
                                <th className="px-6 py-3">Nom</th>
                                <th className="px-6 py-3">Statut</th>
                                <th className="px-6 py-3">Référent</th>
                                <th className="px-6 py-3 text-right">Montant estimé</th>
                                <th className="px-6 py-3">Début théorique</th>
                                <th className="px-6 py-3">Fin théorique</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {!loading && items.length === 0 && (
                                <tr>
                                    <td colSpan={6} className="px-6 py-12 text-center text-slate-400 italic">
                                        Aucun chantier dans la prévision — importe les chantiers existants ou ajoute un chantier à venir.
                                    </td>
                                </tr>
                            )}
                            {items.map(item => (
                                <tr key={item.id} className="text-sm hover:bg-slate-50/30 transition-colors">
                                    <td className="px-6 py-4 font-bold text-slate-900">{item.nom}</td>
                                    <td className="px-6 py-4">
                                        <StatusBadge status={item.statut} type="prevision" />
                                    </td>
                                    <td className="px-6 py-4 text-slate-600">{item.referent_username || '—'}</td>
                                    <td className="px-6 py-4 text-right text-slate-700">{formatCHF(item.montant_estime)}</td>
                                    <td className="px-6 py-4 text-slate-600">{formatDate(item.date_debut_theorique)}</td>
                                    <td className="px-6 py-4 text-slate-600">{formatDate(item.date_fin_theorique)}</td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>

            {showCreate && (
                <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                    <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={() => setShowCreate(false)}></div>
                    <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                        <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-between border-b border-slate-300">
                            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">Nouveau chantier à venir</h3>
                            <button onClick={() => setShowCreate(false)} className="text-slate-500 hover:text-slate-900">
                                <X size={22} />
                            </button>
                        </div>
                        <form onSubmit={handleSubmit} className="p-6 space-y-4">
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Nom</label>
                                <input
                                    type="text"
                                    autoFocus
                                    required
                                    className="input-field"
                                    value={form.nom}
                                    onChange={e => setForm({ ...form, nom: e.target.value })}
                                    placeholder="Ex: Rénovation villa Dupont"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Référent</label>
                                <AwesomeSelect
                                    value={form.referent_id}
                                    onChange={val => setForm({ ...form, referent_id: val })}
                                    options={referentOptions}
                                    placeholder="Référent"
                                />
                            </div>
                            <div>
                                <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Montant estimé (CHF)</label>
                                <input
                                    type="number" min={0} step="0.05"
                                    className="input-field"
                                    value={form.montant_estime}
                                    onChange={e => setForm({ ...form, montant_estime: e.target.value })}
                                    placeholder="Ex: 45000"
                                />
                            </div>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Début théorique</label>
                                    <input
                                        type="date"
                                        className="input-field"
                                        value={form.date_debut_theorique}
                                        onChange={e => setForm({ ...form, date_debut_theorique: e.target.value })}
                                    />
                                </div>
                                <div>
                                    <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Fin théorique</label>
                                    <input
                                        type="date"
                                        className="input-field"
                                        value={form.date_fin_theorique}
                                        onChange={e => setForm({ ...form, date_fin_theorique: e.target.value })}
                                    />
                                </div>
                            </div>
                            {formError && <p className="text-red-500 text-sm font-bold">{formError}</p>}
                            <button
                                type="submit"
                                disabled={submitting}
                                className="w-full bg-ohm-primary text-ohm-bg font-black py-4 rounded-xl shadow-lg hover:bg-yellow-300 transition-all uppercase tracking-widest active:scale-95 disabled:opacity-50"
                            >
                                {submitting ? 'Création...' : 'Enregistrer'}
                            </button>
                        </form>
                    </div>
                </div>
            )}
        </div>
    );
};
