import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Vehicule, VehiculeDetail, VehiculeReparation, VehiculeCoutCategorie, VehiculeStats, User } from '../types';
import { Car, Plus, Pencil, Trash2, ArrowLeft, Gauge, Wrench, Fuel, ChevronLeft, ChevronRight, Wallet } from 'lucide-react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell } from 'recharts';
import { api } from '../api';
import { useConfirm } from '../hooks/useConfirm';
import { ConfirmDialog } from './ConfirmDialog';
import { useMountTransition } from '../hooks/useMountTransition';
import { SlidingTabs } from './ui/SlidingTabs';

// Une seule teinte de marque (magnitude, pas identité — voir dataviz skill) :
// même bleu que .card/.input-field ailleurs dans l'app, pas une palette
// catégorielle puisque chaque graphique n'a qu'une seule série.
const CHART_HUE = '#2563EB';

// Tooltip minimal aux couleurs de l'app plutôt que le style recharts par
// défaut — cohérent avec les autres cards (bg blanc, ombre, coins arrondis).
// `unit` distingue "km" (kilométrage) de "CHF" (coût réparations) — même
// composant pour les deux familles de charts ci-dessous.
const FleetTooltip: React.FC<any> = ({ active, payload, label, unit }) => {
    if (!active || !payload?.length) return null;
    return (
        <div className="bg-white border border-slate-200 rounded-lg shadow-lg px-3 py-2 text-xs">
            <div className="font-bold text-slate-900">{label}</div>
            <div className="text-slate-500">{Math.round(payload[0].value).toLocaleString('fr-CH')} {unit}</div>
        </div>
    );
};

const StatTile: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="card p-4">
        <div className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-1">{label}</div>
        <div className="text-xl font-black text-slate-900 truncate">{value}</div>
    </div>
);

const FleetChart: React.FC<{ title: string; unit: string; data: { label: string; value: number }[] }> = ({ title, unit, data }) => (
    <div className="card p-4">
        <div className="text-[10px] font-black uppercase text-slate-500 tracking-widest mb-3">{title}</div>
        {data.length === 0 ? (
            <div className="text-sm text-slate-400 italic py-8 text-center">Pas encore de données.</div>
        ) : (
            <ResponsiveContainer width="100%" height={Math.max(120, data.length * 34)}>
                <BarChart data={data} layout="vertical" margin={{ top: 0, right: 16, bottom: 0, left: 0 }}>
                    <XAxis type="number" hide />
                    <YAxis
                        type="category" dataKey="label" width={110} tickLine={false} axisLine={false}
                        tick={{ fontSize: 11, fill: '#64748B' }}
                    />
                    <Tooltip content={<FleetTooltip unit={unit} />} cursor={{ fill: '#F1F5F9' }} />
                    <Bar dataKey="value" radius={[0, 4, 4, 0]} maxBarSize={18}>
                        {data.map((_, i) => <Cell key={i} fill={CHART_HUE} />)}
                    </Bar>
                </BarChart>
            </ResponsiveContainer>
        )}
    </div>
);

interface Props {
    currentUser: User;
    // Le popup hebdo (étape 5) redirige ici après "Oui" avec un véhicule déjà
    // sélectionné, et se ré-affiche via onKmEntrySubmitted une fois le
    // blocage levé — les deux optionnels pour que l'écran marche seul
    // (accès normal depuis la nav) sans dépendre du popup.
    forcedVehiculeId?: number | null;
    onKmEntrySubmitted?: () => void;
}

const emptyForm = { marque: '', modele: '', numero_plaque: '', km_actuel: '', leasing_mensuel: '' };

const CATEGORIE_LABELS: Record<VehiculeCoutCategorie, string> = { entretien: 'Entretien', energie: 'Énergie' };
const CATEGORIE_ICONS: Record<VehiculeCoutCategorie, React.ElementType> = { entretien: Wrench, energie: Fuel };

const todayStr = () => new Date().toISOString().split('T')[0];
const emptyReparationForm = { nom: '', montant: '', categorie: 'entretien' as VehiculeCoutCategorie, date: todayStr() };

// --- Coût journalier/hebdomadaire d'un véhicule ---------------------------
// Formule donnée : (leasing + entretien(pneus, mécanique) + énergie(gazole,
// essence ou électricité)) / 365 ou / 52. Leasing est saisi mensuel (voir
// Vehicule.leasing_mensuel) donc annualisé ici (*12) ; entretien/énergie
// sont les totaux de VehiculeReparation.montant pour l'année choisie
// (`year`, pas all-time — un coût par jour n'a de sens que rapporté à une
// période, pas au cumul depuis l'achat du véhicule).
const VehiculeCostSummary: React.FC<{ vehicule: Vehicule; reparations: VehiculeReparation[] }> = ({ vehicule, reparations }) => {
    const [year, setYear] = useState(new Date().getFullYear());

    const totals = useMemo(() => {
        const inYear = reparations.filter(r => r.date_reparation && r.date_reparation.slice(0, 4) === String(year));
        const entretien = inYear.filter(r => r.categorie === 'entretien').reduce((s, r) => s + r.montant, 0);
        const energie = inYear.filter(r => r.categorie === 'energie').reduce((s, r) => s + r.montant, 0);
        return { entretien, energie };
    }, [reparations, year]);

    const leasingAnnuel = vehicule.leasing_mensuel * 12;
    const totalAnnuel = leasingAnnuel + totals.entretien + totals.energie;
    const coutJour = totalAnnuel / 365;
    const coutSemaine = totalAnnuel / 52;
    const fmt = (v: number) => `${v.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} CHF`;

    return (
        <div className="card p-4 sm:p-6 space-y-4">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest flex items-center gap-1.5">
                    <Wallet size={14} className="text-ohm-primary" /> Coût du véhicule
                </h3>
                <div className="flex items-center gap-1 bg-slate-50 rounded-lg p-1">
                    <button onClick={() => setYear(y => y - 1)} className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-white transition-all" aria-label="Année précédente">
                        <ChevronLeft size={14} />
                    </button>
                    <span className="px-1 text-xs font-bold text-slate-900 min-w-[3rem] text-center">{year}</span>
                    <button onClick={() => setYear(y => y + 1)} className="w-7 h-7 flex items-center justify-center rounded-md text-slate-500 hover:text-slate-900 hover:bg-white transition-all" aria-label="Année suivante">
                        <ChevronRight size={14} />
                    </button>
                </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 text-sm">
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Leasing (année)</div>
                    <div className="font-bold text-slate-900">{fmt(leasingAnnuel)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Entretien ({year})</div>
                    <div className="font-bold text-slate-900">{fmt(totals.entretien)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Énergie ({year})</div>
                    <div className="font-bold text-slate-900">{fmt(totals.energie)}</div>
                </div>
            </div>

            <div className="pt-3 border-t border-slate-100 grid grid-cols-3 gap-3">
                <div>
                    <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wide">Total annuel</div>
                    <div className="font-black text-slate-900">{fmt(totalAnnuel)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-ohm-primary uppercase tracking-wide">Coût / jour</div>
                    <div className="font-black text-ohm-primary">{fmt(coutJour)}</div>
                </div>
                <div>
                    <div className="text-[10px] font-bold text-ohm-primary uppercase tracking-wide">Coût / semaine</div>
                    <div className="font-black text-ohm-primary">{fmt(coutSemaine)}</div>
                </div>
            </div>
            {vehicule.leasing_mensuel === 0 && (
                <p className="text-[11px] text-slate-400 italic">
                    Leasing à 0 CHF/mois — renseignez-le via "Modifier" si ce véhicule est en leasing.
                </p>
            )}
        </div>
    );
};

export const Vehicules: React.FC<Props> = ({ currentUser, forcedVehiculeId, onKmEntrySubmitted }) => {
    const canManage = currentUser.role === 'admin' || currentUser.role === 'vehicule';
    const { confirm, confirmDialogProps } = useConfirm();

    const [vehicules, setVehicules] = useState<Vehicule[]>([]);
    const [loading, setLoading] = useState(true);
    const [stats, setStats] = useState<VehiculeStats | null>(null);
    const [selectedId, setSelectedId] = useState<number | null>(forcedVehiculeId ?? null);
    const [detail, setDetail] = useState<VehiculeDetail | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);

    const [showForm, setShowForm] = useState<'create' | 'edit' | null>(null);
    // transitions-dev "06-modal" — closeForm nulls showForm immediately, but
    // the modal stays mounted ~150ms longer to play its close tween and
    // still needs to know 'create' vs 'edit' to render its title/labels —
    // cache the last non-null value for display during that window.
    const formModalT = useMountTransition(showForm !== null, 150);
    const showFormRef = useRef<'create' | 'edit' | null>(null);
    if (showForm) showFormRef.current = showForm;
    const showFormDisplay = showForm ?? showFormRef.current;
    const [form, setForm] = useState(emptyForm);
    const [formError, setFormError] = useState('');
    const [submitting, setSubmitting] = useState(false);

    const [kmInput, setKmInput] = useState('');
    const [kmError, setKmError] = useState('');
    const [kmSubmitting, setKmSubmitting] = useState(false);
    // "sous-comptage hebdomadaire ou mensuel" — bascule l'historique entre
    // le relevé brut par semaine (déjà ce qu'enregistre chaque relevé, voir
    // VehiculeKmEntry) et une agrégation par mois calendaire (voir
    // monthlyKmEntries plus bas) — purement une autre vue des mêmes
    // données déjà chargées, pas un nouvel appel serveur.
    const [kmView, setKmView] = useState<'semaine' | 'mois'>('semaine');

    const [reparations, setReparations] = useState<VehiculeReparation[]>([]);
    const [showReparationForm, setShowReparationForm] = useState(false);
    const [reparationForm, setReparationForm] = useState(emptyReparationForm);
    const [reparationError, setReparationError] = useState('');
    const [reparationSubmitting, setReparationSubmitting] = useState(false);

    const fetchList = async () => {
        const res = await api.get('/api/vehicules');
        if (res.ok) setVehicules(await res.json());
        setLoading(false);
    };

    const fetchStats = async () => {
        const res = await api.get('/api/vehicules/stats');
        if (res.ok) setStats(await res.json());
    };

    useEffect(() => { fetchList(); fetchStats(); }, []);

    const fetchDetail = async (id: number) => {
        setDetailLoading(true);
        const res = await api.get(`/api/vehicules/${id}`);
        if (res.ok) setDetail(await res.json());
        setDetailLoading(false);
    };

    const fetchReparations = async (id: number) => {
        const res = await api.get(`/api/vehicules/${id}/reparations`);
        if (res.ok) setReparations(await res.json());
    };

    useEffect(() => {
        if (selectedId != null) { fetchDetail(selectedId); fetchReparations(selectedId); }
        else { setDetail(null); setReparations([]); }
        setShowReparationForm(false);
        setReparationForm(emptyReparationForm);
        setReparationError('');
        setKmView('semaine');
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
        setForm({ marque: v.marque, modele: v.modele, numero_plaque: v.numero_plaque, km_actuel: String(v.km_actuel), leasing_mensuel: String(v.leasing_mensuel) });
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
                leasing_mensuel: form.leasing_mensuel === '' ? undefined : Number(form.leasing_mensuel),
            };
            const res = showForm === 'edit' && detail
                ? await api.put(`/api/vehicules/${detail.id}`, payload)
                : await api.post('/api/vehicules', payload);
            if (res.ok) {
                setShowForm(null);
                fetchList();
                fetchStats();
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
        const ok = await confirm({
            title: 'Supprimer ce véhicule ?',
            message: `${v.marque} ${v.modele} (${v.numero_plaque}) et son historique de relevés seront définitivement supprimés.`,
        });
        if (!ok) return;
        const res = await api.delete(`/api/vehicules/${v.id}`);
        if (res.ok) {
            if (selectedId === v.id) setSelectedId(null);
            fetchList();
            fetchStats();
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
                fetchStats();
                onKmEntrySubmitted?.();
            } else {
                const data = await res.json().catch(() => ({}));
                setKmError(data.error || 'Erreur lors de l\'envoi du relevé');
            }
        } finally {
            setKmSubmitting(false);
        }
    };

    const handleSubmitReparation = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!detail) return;
        setReparationError('');
        const nom = reparationForm.nom.trim();
        const montant = Number(reparationForm.montant);
        if (!nom) {
            setReparationError('Le nom de la réparation est requis');
            return;
        }
        if (reparationForm.montant === '' || Number.isNaN(montant) || montant < 0) {
            setReparationError('Entrez un montant de facture valide');
            return;
        }
        setReparationSubmitting(true);
        try {
            const res = await api.post(`/api/vehicules/${detail.id}/reparations`, {
                nom, montant, categorie: reparationForm.categorie, date: reparationForm.date,
            });
            if (res.ok) {
                setReparationForm(emptyReparationForm);
                setShowReparationForm(false);
                fetchReparations(detail.id);
                fetchStats();
            } else {
                const data = await res.json().catch(() => ({}));
                setReparationError(data.error || 'Erreur lors de l\'enregistrement');
            }
        } finally {
            setReparationSubmitting(false);
        }
    };

    const handleDeleteReparation = async (r: VehiculeReparation) => {
        const ok = await confirm({
            title: 'Supprimer cette réparation ?',
            message: `« ${r.nom} » (${r.montant.toLocaleString('fr-CH')} CHF) sera définitivement supprimée.`,
        });
        if (!ok) return;
        const res = await api.delete(`/api/vehicules/reparations/${r.id}`);
        if (res.ok) {
            if (detail) fetchReparations(detail.id);
            fetchStats();
        } else {
            const data = await res.json().catch(() => ({}));
            alert(data.error || 'Erreur lors de la suppression');
        }
    };

    const formatDate = (iso: string | null) =>
        iso ? new Date(iso).toLocaleDateString('fr-CH', { day: 'numeric', month: 'long', year: 'numeric' }) : '—';

    // --- Vue détail ---
    if (selectedId != null) {
        const maxKm = detail ? Math.max(1, ...detail.km_entries.map(e => e.km_parcourus)) : 1;
        // Agrégation mensuelle — même donnée que km_entries (semaine_iso +
        // km_parcourus), juste regroupée par mois calendaire de date_entry
        // au lieu d'être listée semaine par semaine. Triée la plus récente
        // en premier, comme la vue hebdomadaire (voir [...].reverse() ci-dessous).
        const monthlyKmEntries = detail
            ? Object.values(
                detail.km_entries.reduce((acc, e) => {
                    const key = (e.date_entry || '').slice(0, 7); // "YYYY-MM"
                    if (!key) return acc;
                    if (!acc[key]) acc[key] = { key, km_parcourus: 0 };
                    acc[key].km_parcourus += e.km_parcourus;
                    return acc;
                }, {} as Record<string, { key: string; km_parcourus: number }>)
            ).sort((a, b) => b.key.localeCompare(a.key))
            : [];
        const maxMonthlyKm = Math.max(1, ...monthlyKmEntries.map(m => m.km_parcourus));
        const formatMonth = (key: string) => {
            const [y, m] = key.split('-').map(Number);
            return new Date(y, m - 1, 1).toLocaleDateString('fr-CH', { month: 'long', year: 'numeric' });
        };
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
                                {canManage && (
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

                        <VehiculeCostSummary vehicule={detail} reparations={reparations} />

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
                            <div className="flex items-center justify-between flex-wrap gap-3 mb-3">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Historique kilométrique</h3>
                                <SlidingTabs
                                    tabs={[{ id: 'semaine', label: 'Semaine' }, { id: 'mois', label: 'Mois' }]}
                                    active={kmView}
                                    onChange={setKmView}
                                />
                            </div>
                            {detail.km_entries.length === 0 ? (
                                <div className="card p-8 text-center text-slate-400 italic">Aucun relevé pour l'instant.</div>
                            ) : kmView === 'semaine' ? (
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
                            ) : (
                                <div className="space-y-2">
                                    {monthlyKmEntries.map(m => (
                                        <div key={m.key} className="card p-3 flex items-center gap-3">
                                            <div className="w-32 shrink-0 text-xs font-bold text-slate-700 capitalize truncate">{formatMonth(m.key)}</div>
                                            <div className="flex-1 min-w-0">
                                                <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
                                                    <div
                                                        className="h-full bg-ohm-primary rounded-full"
                                                        style={{ width: `${Math.max(4, (m.km_parcourus / maxMonthlyKm) * 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                            <div className="w-20 shrink-0 text-right text-sm font-bold text-slate-900">{Math.round(m.km_parcourus)} km</div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        <div>
                            <div className="flex items-center justify-between mb-3">
                                <h3 className="text-xs font-bold text-slate-500 uppercase tracking-widest">Coûts (entretien &amp; énergie)</h3>
                                {canManage && (
                                    <button
                                        onClick={() => { setReparationError(''); setShowReparationForm(v => !v); }}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all text-xs font-bold"
                                    >
                                        <Plus size={14} /> Ajouter
                                    </button>
                                )}
                            </div>

                            {showReparationForm && (
                                <form onSubmit={handleSubmitReparation} className="card p-4 sm:p-6 space-y-3 mb-3">
                                    <div>
                                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-1.5">Catégorie</label>
                                        <div className="flex gap-2">
                                            {(['entretien', 'energie'] as VehiculeCoutCategorie[]).map(cat => {
                                                const Icon = CATEGORIE_ICONS[cat];
                                                const active = reparationForm.categorie === cat;
                                                return (
                                                    <button
                                                        key={cat} type="button"
                                                        onClick={() => setReparationForm({ ...reparationForm, categorie: cat })}
                                                        className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-sm font-bold transition-all ${active ? 'bg-ohm-primary text-ohm-bg' : 'bg-slate-100 text-slate-500 hover:bg-slate-200'}`}
                                                    >
                                                        <Icon size={14} /> {CATEGORIE_LABELS[cat]}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                    <div className="grid sm:grid-cols-3 gap-3">
                                        <div className="sm:col-span-2">
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-1.5">
                                                {reparationForm.categorie === 'energie' ? 'Description (ex: Plein diesel)' : 'Nom de la réparation'}
                                            </label>
                                            <input
                                                type="text" autoFocus
                                                className="input-field"
                                                value={reparationForm.nom}
                                                onChange={e => setReparationForm({ ...reparationForm, nom: e.target.value })}
                                                placeholder={reparationForm.categorie === 'energie' ? 'Ex: Plein diesel' : 'Ex: Plaquettes de frein'}
                                            />
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-1.5">Facture (CHF)</label>
                                            <input
                                                type="number" min={0} step="0.05"
                                                className="input-field"
                                                value={reparationForm.montant}
                                                onChange={e => setReparationForm({ ...reparationForm, montant: e.target.value })}
                                                placeholder="0.00"
                                            />
                                        </div>
                                    </div>
                                    <div>
                                        <label className="text-[10px] font-black uppercase text-slate-500 tracking-widest block mb-1.5">Date de la dépense</label>
                                        <input
                                            type="date"
                                            className="input-field"
                                            value={reparationForm.date}
                                            onChange={e => setReparationForm({ ...reparationForm, date: e.target.value })}
                                        />
                                    </div>
                                    {reparationError && <p className="text-red-500 text-sm font-bold">{reparationError}</p>}
                                    <div className="flex gap-2">
                                        <button type="submit" disabled={reparationSubmitting} className="px-5 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all text-sm font-bold disabled:opacity-50">
                                            Enregistrer
                                        </button>
                                        <button type="button" onClick={() => setShowReparationForm(false)} className="px-5 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all text-sm font-bold">
                                            Annuler
                                        </button>
                                    </div>
                                </form>
                            )}

                            {reparations.length === 0 ? (
                                <div className="card p-8 text-center text-slate-400 italic">Aucun coût enregistré.</div>
                            ) : (
                                <div className="space-y-2">
                                    {reparations.map(r => {
                                        const Icon = CATEGORIE_ICONS[r.categorie];
                                        return (
                                            <div key={r.id} className="card p-3 flex items-center gap-3">
                                                <div className={`w-9 h-9 rounded-xl flex items-center justify-center shrink-0 ${r.categorie === 'energie' ? 'bg-blue-500/15' : 'bg-ohm-primary/15'}`}>
                                                    <Icon className={r.categorie === 'energie' ? 'text-blue-600' : 'text-ohm-primary'} size={16} />
                                                </div>
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <div className="text-sm font-bold text-slate-900 truncate">{r.nom}</div>
                                                        <span className={`shrink-0 px-1.5 py-0.5 rounded text-[9px] font-black uppercase tracking-wide ${r.categorie === 'energie' ? 'bg-blue-500/15 text-blue-600' : 'bg-slate-100 text-slate-500'}`}>
                                                            {CATEGORIE_LABELS[r.categorie]}
                                                        </span>
                                                    </div>
                                                    <div className="text-[10px] text-slate-400">{formatDate(r.date_reparation)} · {r.created_by || '—'}</div>
                                                </div>
                                                <div className="text-sm font-black text-slate-900 shrink-0">{r.montant.toLocaleString('fr-CH')} CHF</div>
                                                {canManage && (
                                                    <button onClick={() => handleDeleteReparation(r)} className="p-2 rounded-lg text-red-400 hover:bg-red-500/10 transition-all shrink-0" title="Supprimer">
                                                        <Trash2 size={16} />
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    </>
                )}

                {renderForm()}
                {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
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
                {canManage && (
                    <button
                        onClick={openCreate}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all font-bold text-sm"
                    >
                        <Plus size={16} /> Nouveau véhicule
                    </button>
                )}
            </div>

            {stats && (stats.vehicule_count > 0 || stats.km_par_utilisateur.length > 0) && (
                <div className="space-y-4">
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        <StatTile label="Km total flotte" value={`${Math.round(stats.total_km_flotte).toLocaleString('fr-CH')} km`} />
                        <StatTile label="Véhicules" value={String(stats.vehicule_count)} />
                        <StatTile
                            label="Top conducteur"
                            value={stats.km_par_utilisateur[0]
                                ? `${stats.km_par_utilisateur[0].username} · ${Math.round(stats.km_par_utilisateur[0].total_km).toLocaleString('fr-CH')} km`
                                : '—'}
                        />
                        <StatTile label="Réparations (total)" value={`${Math.round(stats.total_reparations_cout).toLocaleString('fr-CH')} CHF`} />
                    </div>
                    <div className="grid md:grid-cols-2 gap-4">
                        <FleetChart
                            title="Km au compteur par véhicule"
                            unit="km"
                            data={stats.km_par_vehicule.slice(0, 8).map(v => ({ label: v.label, value: v.km_actuel }))}
                        />
                        <FleetChart
                            title="Km parcourus par conducteur"
                            unit="km"
                            data={stats.km_par_utilisateur.slice(0, 8).map(u => ({ label: u.username, value: u.total_km }))}
                        />
                        <FleetChart
                            title="Coût réparations par véhicule"
                            unit="CHF"
                            data={stats.reparations_par_vehicule.slice(0, 8).map(r => ({ label: r.label, value: r.total_montant }))}
                        />
                    </div>
                </div>
            )}

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
                        {canManage && (
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
            {confirmDialogProps && <ConfirmDialog {...confirmDialogProps} />}
        </div>
    );

    function renderForm() {
        if (!formModalT.mounted) return null;
        return (
            <div className={`t-modal ${formModalT.active ? 'is-open' : 'is-closing'} fixed inset-0 z-[100] flex items-center justify-center p-4`}>
                <div className="absolute inset-0 bg-ohm-bg/80 backdrop-blur-sm" onClick={closeForm} />
                <div className="relative w-full max-w-md bg-ohm-surface rounded-3xl border border-slate-300 shadow-2xl overflow-hidden">
                    <div className="bg-slate-50/80 px-6 py-4 flex items-center justify-between border-b border-slate-300">
                        <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">
                            {showFormDisplay === 'edit' ? 'Modifier' : 'Nouveau'} véhicule
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
                                Kilométrage {showFormDisplay === 'edit' ? '(correction manuelle)' : 'actuel'}
                            </label>
                            <input
                                type="number" min={0} step="any"
                                value={form.km_actuel}
                                onChange={e => setForm({ ...form, km_actuel: e.target.value })}
                                className="input-field"
                                placeholder="0"
                            />
                        </div>
                        <div>
                            <label className="block text-[10px] font-black uppercase text-slate-500 mb-2 tracking-widest">
                                Leasing mensuel (CHF/mois)
                            </label>
                            <input
                                type="number" min={0} step="0.05"
                                value={form.leasing_mensuel}
                                onChange={e => setForm({ ...form, leasing_mensuel: e.target.value })}
                                className="input-field"
                                placeholder="0 (véhicule acheté comptant)"
                            />
                        </div>
                        {formError && <p className="text-red-500 text-sm font-bold">{formError}</p>}
                        <button
                            type="submit"
                            disabled={submitting}
                            className="w-full bg-ohm-primary text-ohm-bg font-black py-4 rounded-xl shadow-lg hover:bg-yellow-300 transition-all uppercase tracking-widest active:scale-95 disabled:opacity-50"
                        >
                            {showFormDisplay === 'edit' ? 'Mettre à jour' : 'Enregistrer'}
                        </button>
                    </form>
                </div>
            </div>
        );
    }
};
