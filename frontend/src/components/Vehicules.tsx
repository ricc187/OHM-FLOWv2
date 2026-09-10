import React, { useEffect, useState } from 'react';
import { Vehicule, VehiculeDetail, User } from '../types';
import { Car, Plus, Pencil, Trash2, ArrowLeft, Gauge } from 'lucide-react';
import { api } from '../api';

interface Props {
    currentUser: User;
    // Le popup hebdo (étape 5) redirige ici après "Oui" avec un véhicule déjà
    // sélectionné, et se ré-affiche via onKmEntrySubmitted une fois le
    // blocage levé — les deux optionnels pour que l'écran marche seul
    // (accès normal depuis la nav) sans dépendre du popup.
    forcedVehiculeId?: number | null;
    onKmEntrySubmitted?: () => void;
}

const emptyForm = { marque: '', modele: '', numero_plaque: '', km_actuel: '' };

export const Vehicules: React.FC<Props> = ({ currentUser, forcedVehiculeId, onKmEntrySubmitted }) => {
    const isAdmin = currentUser.role === 'admin';

    const [vehicules, setVehicules] = useState<Vehicule[]>([]);
    const [loading, setLoading] = useState(true);
    const [selectedId, setSelectedId] = useState<number | null>(forcedVehiculeId ?? null);
    const [detail, setDetail] = useState<VehiculeDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [showForm, setShowForm] = useState<'create' | 'edit' | null>(null);
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [kmInput, setKmInput] = useState('');
    const [kmError, setKmError] = useState('');
    const [kmSubmitting, setKmSubmitting] = useState(false);

    const fetchList = async () => {
        const res = await api.get('/api/vehicules');
        if (res.ok) setVehicules(await res.json());
        setLoading(false);
    };

    useEffect(() => { fetchList(); }, []);

    const fetchDetail = async (id: number) => {
        setDetailLoading(true);
        const res = await api.get(`/api/vehicules/${id}`);
        if (res.ok) setDetail(await res.json());
        setDetailLoading(false);
    };

    useEffect(() => {
        if (selectedId != null) fetchDetail(selectedId);
        else setDetail(null);
    }, [selectedId]);

    // Pré-remplit avec le kilométrage actuel — l'utilisateur lit un chiffre
    // sur le compteur et corrige à partir de là, il ne part pas de zéro à
    // chaque fois (voir handleSubmitKm : le champ est un total, pas un
    // delta). Se redéclenche aussi après un envoi réussi (km_actuel change),
    // pour remontrer la nouvelle valeur de référence plutôt qu'un champ vide.
    useEffect(() => {
        if (detail) setKmInput(String(detail.km_actuel));
    }, [detail?.id, detail?.km_actuel]);

    // Un forcedVehiculeId qui change (ex: le popup redirige vers un autre
    // véhicule) doit re-sélectionner même si c'était déjà la vue courante.
    useEffect(() => {
        if (forcedVehiculeId != null) setSelectedId(forcedVehiculeId);
    }, [forcedVehiculeId]);

    const openCreate = () => {
        setForm(emptyForm);
        setFormError('');
        setShowForm('create');
    };

    const openEdit = (v: Vehicule) => {
        setForm({ marque: v.marque, modele: v.modele, numero_plaque: v.numero_plaque, km_actuel: String(v.km_actuel) });
        setFormError('');
        setShowForm('edit');
    };

    const closeForm = () => setShowForm(null);

    const handleSubmitForm = async (e: React.FormEvent) => {
        e.preventDefault();
        setFormError('');
        setSubmitting(true);
        try {
            const payload = {
                marque: form.marque.trim(),
                modele: form.modele.trim(),
                numero_plaque: form.numero_plaque.trim(),
                km_actuel: form.km_actuel === '' ? undefined : Number(form.km_actuel),
            };
            const res = showForm === 'edit' && detail
                ? await api.put(`/api/vehicules/${detail.id}`, payload)
                : await api.post('/api/vehicules', payload);
            if (res.ok) {
                setShowForm(null);
                fetchList();
                if (detail) fetchDetail(detail.id);
            } else {
                const data = await res.json().catch(() => ({}));
                setFormError(data.error || 'Erreur');
            }
        } finally {
            setSubmitting(false);
        }
    };

    const handleDelete = async (v: Vehicule) => {
        if (!confirm(`Supprimer ${v.marque} ${v.modele} (${v.numero_plaque}) ?`)) return;
        const res = await api.delete(`/api/vehicules/${v.id}`);
        if (res.ok) {
            if (selectedId === v.id) setSelectedId(null);
            fetchList();
        } else {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Erreur lors de la suppression');
        }
    };

    const handleSubmitKm = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!detail) return;
        setKmError('');
        const kmActuelNouveau = Number(kmInput);
        // Le champ est le kilométrage total relevé sur le compteur (pas un
        // delta) — voir add_vehicule_km_entry côté backend. Un compteur ne
        // recule jamais : en dessous du km_actuel courant, on ne laisse même
        // pas partir la requête.
        if (!kmInput || Number.isNaN(kmActuelNouveau) || kmActuelNouveau < detail.km_actuel) {
            setKmError(`Entrez un kilométrage valide (≥ ${detail.km_actuel.toLocaleString('fr-CH')} km)`);
            return;
        }
        setKmSubmitting(true);
        try {
            const res = await api.post(`/api/vehicules/${detail.id}/km-entries`, { km_actuel: kmActuelNouveau });
            if (res.ok) {
                await fetchDetail(detail.id);
                fetchList();
                onKmEntrySubmitted?.();
            } else {
                const data = await res.json().catch(() => ({}));
                setKmError(data.error || 'Erreur lors de l\'envoi du relevé');
            }
        } finally {
            setKmSubmitting(false);
        }
    };

    const formatDate = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

    // --- Vue détail ---
    if (selectedId != null) {
        const maxKm = detail ? Math.max(1, ...detail.km_entries.map(e => e.km_parcourus)) : 1;
        return (
            <div className="space-y-6 animate-fade-in pb-12">
                <button
                    onClick={() => setSelectedId(null)}
                    className="flex items-center gap-2 text-slate-500 hover:text-slate-900 font-bold text-sm transition-all"
                >
                    <ArrowLeft size={16} /> Retour aux véhicules
                </button>

                {detailLoading && !detail && (
                    <div className="card p-12 text-center text-slate-400 italic">Chargement…</div>
                )}

                {detail && (
                    <>
                        <div className="card p-6 flex flex-wrap items-center justify-between gap-4">
                            <div>
                                <h2 className="text-2xl font-bold text-slate-900">{detail.marque} {detail.modele}</h2>
                                <p className="text-slate-500 font-mono">{detail.numero_plaque}</p>
                            </div>
                            <div className="flex items-center gap-3">
                                <div className="text-right">
                                    <div className="text-3xl font-black text-ohm-primary flex items-center gap-2 justify-end">
                                        <Gauge size={26} /> {detail.km_actuel.toLocaleString('fr-CH')} km
                                    </div>
                                    <div className="text-xs text-slate-400 uppercase tracking-widest">Kilométrage actuel</div>
                                </div>
                                {isAdmin && (
                                    <div className="flex items-center gap-1 shrink-0">
                                        <button onClick={() => openEdit(detail)} className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100 transition-all" title="Modifier">
                                            <Pencil size={16} />
                                        </button>
                                        <button onClick={() => handleDelete(detail)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all" title="Supprimer">
                                            <Trash2 size={16} />
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>

                        {/* Ouvert à tout user connecté — pas juste admin, voir POST
                            /api/vehicules/<id>/km-entries. C'est aussi ce qui débloque
                            la navigation quand on arrive ici depuis le popup hebdo
                            (étape 5) après avoir répondu "Oui". */}
                        <form onSubmit={handleSubmitKm} className="card p-4 sm:p-6 space-y-3">
                            <label className="text-xs font-bold text-slate-500 uppercase tracking-widest block">
                                Mettre à jour le kilométrage (relevé compteur)
                            </label>
                            <div className="flex flex-wrap gap-3">
                                <input
                                    type="number" min={detail.km_actuel} step="any"
                                    className="input-field flex-1 min-w-[140px]"
                                    value={kmInput}
                                    onChange={e => setKmInput(e.target.value)}
                                />
                                <button type="submit" disabled={kmSubmitting} className="px-5 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all text-sm font-bold disabled:opacity-50">
                                    Envoyer
                                </button>
                            </div>
                            {kmError && <p className="text-red-500 text-sm font-bold">{kmError}</p>}
                        </form>

                        <div>
                            <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest mb-3">Historique hebdomadaire</h3>
                            {detail.km_entries.length === 0 ? (
                                <div className="card p-8 text-center text-slate-400 italic">Aucun relevé pour l'instant.</div>
                            ) : (
                                <div className="space-y-2">
                                    {[...detail.km_entries].reverse().map(entry => (
                                        <div key={entry.id} className="card p-3 flex items-center gap-3">
                                            <div className="w-28 shrink-0">
                                            <div className="text-xs font-bold text-slate-700">{entry.semaine_iso}</div>
                                            <div className="text-[10px] text-slate-400">{formatDate(entry.date_entry)}</div>
                                        </div>
                                            <div className="flex-1 min-w-0">
                                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-ohm-primary rounded-full"
                                                        style={{ width: `${Math.max(4, (entry.km_parcourus / maxKm) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="w-20 shrink-0 text-right text-sm font-bold text-slate-900">{entry.km_parcourus} km</div>
                                            <div className="w-32 shrink-0 text-right text-xs text-slate-400 hidden sm:block">{entry.user || '—'}</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {renderForm()}
            </div>
        );
    }

    // --- Vue liste ---
    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Car className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Véhicules</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Parc de véhicules de l'entreprise et relevés kilométriques.</p>
                </div>
                {isAdmin && (
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all font-bold text-sm"
                    >
                        <Plus size={16} /> Nouveau véhicule
                    </button>
                )}
            </div>

            <div className="space-y-3">
                {!loading && vehicules.length === 0 && (
                    <div className="card p-12 text-center text-slate-400 italic">Aucun véhicule pour l'instant.</div>
                )}
                {vehicules.map(v => (
                    <div key={v.id} className="card p-4 flex items-center gap-3">
                        <button onClick={() => setSelectedId(v.id)} className="flex-1 min-w-0 text-left flex items-center gap-4">
                            <div className="w-10 h-10 rounded-xl bg-ohm-primary/15 flex items-center justify-center shrink-0">
                                <Car className="text-ohm-primary" size={20} />
                            </div>
                            <div className="min-w-0">
                                <div className="text-slate-900 font-bold truncate">{v.marque} {v.modele}</div>
                                <div className="text-xs text-slate-400 font-mono">{v.numero_plaque}</div>
                            </div>
                        </button>
                        <div className="text-right shrink-0">
                            <div className="font-black text-slate-900">{v.km_actuel.toLocaleString('fr-CH')} km</div>
                        </div>
                        {isAdmin && (
                            <div className="flex items-center gap-1 shrink-0">
                                <button onClick={() => openEdit(v)} className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:bg-slate-100 transition-all" title="Modifier">
                                    <Pencil size={16} />
                                </button>
                                <button onClick={() => handleDelete(v)} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all" title="Supprimer">
                                    <Trash2 size={16} />
                                </button>
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {renderForm()}
        </div>
    );

    function renderForm() {
        if (!showForm) return null;
        return (
            <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={closeForm} />
                <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden animate-in zoom-in duration-200">
                    <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-between border-b border-slate-300">
                        <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                            {showForm === 'edit' ? 'Modifier' : 'Nouveau'} véhicule
                        </h3>
                        <button onClick={closeForm} className="text-slate-500 hover:text-slate-900">
                            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M6 18L18 6M6 6l12 12" />
                            </svg>
                        </button>
                    </div>
                    <form onSubmit={handleSubmitForm} className="p-6 space-y-5">
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Marque</label>
                            <input
                                type="text" required autoFocus
                                value={form.marque}
                                onChange={e => setForm({ ...form, marque: e.target.value })}
                                className="input-field"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Modèle</label>
                            <input
                                type="text" required
                                value={form.modele}
                                onChange={e => setForm({ ...form, modele: e.target.value })}
                                className="input-field"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">Numéro de plaque</label>
                            <input
                                type="text" required
                                value={form.numero_plaque}
                                onChange={e => setForm({ ...form, numero_plaque: e.target.value })}
                                className="input-field font-mono"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">
                                Kilométrage {showForm === 'edit' ? '(correction manuelle)' : 'actuel'}
                            </label>
                            <input
                                type="number" min={0} step="any"
                                value={form.km_actuel}
                                onChange={e => setForm({ ...form, km_actuel: e.target.value })}
                                className="input-field"
                                placeholder="0"
                            />
                        </div>
                        {formError && <p className="text-red-500 text-sm font-bold">{formError}</p>}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-ohm-primary text-ohm-bg font-black py-4 rounded-xl shadow-lg hover:bg-yellow-300 transition-all uppercase tracking-widest active:scale-95 disabled:opacity-50"
                        >
                            {showForm === 'edit' ? 'Mettre à jour' : 'Enregistrer'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }
};
