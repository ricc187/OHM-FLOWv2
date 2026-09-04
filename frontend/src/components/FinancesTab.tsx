import React, { useEffect, useState } from 'react';
import { Loader2, TrendingUp, TrendingDown, Pencil, Plus, Trash2, Check, X, AlertTriangle } from 'lucide-react';
import { Acompte, AchatMateriel, CaLignePrevue, ChantierFinancierPrevu, FinancierPayload, VoltaDocumentLink } from '../types';
import { api } from '../api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';

// Reproduit la mise en page de G 500 Analyse Chantier.xlsx à l'identique :
// même bandeau PRÉVISIONNEL/RÉALISÉ/ÉCART, mêmes titres de section
// (CHIFFRE AFFAIRES / MATERIEL / PERSONNEL), mêmes libellés de ligne, même
// ordre. Le CA prévisionnel (adjugé/régie/PV clients/...) est une vraie
// liste à taille libre — 1 ligne ou 5 selon le chantier — pas 3 champs fixes.
// Chaque section est sa PROPRE carte/table — pas une grande table continue —
// pour qu'un vrai espace (fond de page visible) sépare CA/Matériel/Personnel/
// Débours sec, plutôt qu'une simple ligne blanche à l'intérieur d'un même bloc.

interface Props {
    chantierId: number;
    // Avancement physique déclaré à la main sur la fiche chantier (0-100, voir
    // ChantierDetail) — affiché ici pour comparer avec les % calculés du budget.
    avancementDeclare?: number | null;
}

const formatCHF = (v: number | null | undefined) =>
    v == null ? '—' : v.toLocaleString('fr-CH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const formatHeures = (v: number | null | undefined) => v == null ? '—' : v.toLocaleString('fr-CH', { maximumFractionDigits: 2 });
const formatPct = (v: number | null | undefined) => v == null ? '—' : `${(v * 100).toLocaleString('fr-CH', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;

const signColor = (v: number | null | undefined, invert = false) => {
    if (v == null || v === 0) return 'text-slate-600';
    const good = invert ? v < 0 : v > 0;
    return good ? 'text-green-600' : 'text-red-500';
};

// Code couleur du tableau : bleu = champ que tu peux remplir/modifier,
// gris = calculé automatiquement (jamais éditable). Le vert/rouge des
// écarts est un signal séparé (mieux/moins bien que prévu), voir signColor.
const FIELD = 'bg-blue-50/70';
const RESULT = 'bg-slate-50/80 text-slate-600';

// --- Cellules du tableau ---

const Td: React.FC<{ children?: React.ReactNode; className?: string; colSpan?: number; rowSpan?: number; title?: string }> = ({ children, className, colSpan, rowSpan, title }) => (
    <td colSpan={colSpan} rowSpan={rowSpan} title={title} className={`px-2.5 py-1.5 border border-slate-200 align-middle ${className || ''}`}>{children}</td>
);

// Colonne "vide" — garde la grille alignée là où Excel n'avait rien, sans
// bordure ni fond pour ne pas quadriller un espace qui doit rester nu.
const Blank: React.FC = () => <td className="px-2.5 py-1.5">&nbsp;</td>;

const NumCell: React.FC<{ editing: boolean; value: string; onChange: (v: string) => void; step?: string; placeholder?: string; formatted: React.ReactNode }> =
    ({ editing, value, onChange, step = '0.01', placeholder, formatted }) =>
        editing ? (
            <input
                type="number" step={step} min="0" inputMode="decimal" placeholder={placeholder}
                className="w-full px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs sm:text-sm bg-white"
                value={value} onChange={e => onChange(e.target.value)}
            />
        ) : <>{formatted}</>;

// Bandeau d'en-tête — répété en haut de chaque section maintenant que
// chaque section est sa propre table (réf. Excel ligne 6).
const TopHeader: React.FC = () => (
    <tr>
        <Td colSpan={3} className="bg-slate-900 text-white text-center font-black uppercase tracking-wider text-xs">Budget prévisionnel</Td>
        <Td colSpan={2} className="bg-slate-700 text-white text-center font-black uppercase tracking-wider text-xs">Réalisé</Td>
        <Td className="bg-ohm-primary text-ohm-bg text-center font-black uppercase tracking-wider text-xs">Écart</Td>
    </tr>
);

// Titre de section pleine largeur (réf. B8/B17/B28), avec le crayon
// d'édition de cette section à droite quand elle en a un.
const SectionTitle: React.FC<{ title: string; action?: React.ReactNode }> = ({ title, action }) => (
    <tr>
        <Td colSpan={5} className="bg-slate-100 font-black uppercase tracking-wide text-xs text-slate-700">{title}</Td>
        <Td className="bg-slate-100 text-right">{action}</Td>
    </tr>
);

const SubHeader: React.FC<{ a: string; b: string }> = ({ a, b }) => (
    <tr className="text-[10px] font-bold text-slate-400 uppercase">
        <Td></Td>
        <Td className="text-right">{a}</Td>
        <Td className="text-right">{b}</Td>
        <Td colSpan={3}></Td>
    </tr>
);

const SectionEditToggle: React.FC<{ editing: boolean; saving: boolean; onEdit: () => void; onSave: () => void; onCancel: () => void }> =
    ({ editing, saving, onEdit, onSave, onCancel }) => editing ? (
        <span className="inline-flex items-center gap-1">
            <button onClick={onCancel} disabled={saving} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50" title="Annuler"><X size={13} /></button>
            <button onClick={onSave} disabled={saving} className="p-1 rounded text-green-600 hover:bg-green-500/10 disabled:opacity-50" title="Enregistrer">
                {saving ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            </button>
        </span>
    ) : (
        <button onClick={onEdit} className="p-1 rounded text-slate-400 hover:text-ohm-primary hover:bg-black/5" title="Modifier"><Pencil size={13} /></button>
    );

// Un bloc de section = sa propre carte + sa propre table — c'est ÇA qui crée
// le vrai espace vide entre sections (le fond de la page respire entre deux
// cartes), pas une ligne blanche à l'intérieur d'une même table.
const SectionCard: React.FC<{ children: React.ReactNode }> = ({ children }) => (
    <div className="card p-0 overflow-x-auto">
        <table className="w-full min-w-[760px] border-collapse text-xs sm:text-sm font-mono">
            <tbody>{children}</tbody>
        </table>
    </div>
);

// --- Donut d'avancement (% réel / prévu) ---
// <90% = neutre (encore en cours), 90-100% = ambre (bientôt au budget),
// >100% = rouge (dépassement). null (dénominateur nul) = gris "—".
const DonutStat: React.FC<{ label: string; pct: number | null; colorOverride?: string }> = ({ label, pct, colorOverride }) => {
    const size = 108, stroke = 11, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const clamped = pct == null ? 0 : Math.max(0, Math.min(pct, 1));
    // colorOverride : pour un % qui n'est pas un "avancement vs budget" (donc
    // sans notion de dépassement) — l'avancement déclaré par exemple, où le
    // vert/ambre/rouge habituel (90%/100% de BUDGET) n'a pas de sens.
    const color = colorOverride ?? (pct == null ? '#94a3b8' : pct > 1 ? '#ef4444' : pct >= 0.9 ? '#f59e0b' : '#16a34a');
    return (
        <div className="flex flex-col items-center gap-2">
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="#e2e8f0" strokeWidth={stroke} />
                    <circle
                        cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} strokeLinecap="round"
                        className="transition-[stroke-dashoffset] duration-500 ease-out"
                    />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    <span className="text-xl font-black font-mono" style={{ color }}>{formatPct(pct)}</span>
                </div>
            </div>
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide text-center leading-tight">{label}</span>
        </div>
    );
};

type Draft = Record<string, string>;
const toDraft = (f: ChantierFinancierPrevu, keys: (keyof ChantierFinancierPrevu)[]): Draft =>
    Object.fromEntries(keys.map(k => [k, String(f[k])]));

type CaLigneDraftShape = { libelle: string; montant: string; heures: string };
type AcompteDraftShape = { libelle: string; montant: string; date: string };

export const FinancesTab: React.FC<Props> = ({ chantierId, avancementDeclare }) => {
    const [data, setData] = useState<FinancierPayload | null>(null);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [busyId, setBusyId] = useState<number | null>(null);

    // Chiffre d'affaires — UN crayon en haut à droite édite tout le bloc :
    // chaque ligne CA prévue ET chaque acompte réel existants deviennent
    // éditables en même temps (même principe que "Matériel" pour les achats).
    const [caEditing, setCaEditing] = useState(false);
    const [caLignesEditDraft, setCaLignesEditDraft] = useState<Record<number, CaLigneDraftShape>>({});
    const [acomptesEditDraft, setAcomptesEditDraft] = useState<Record<number, AcompteDraftShape>>({});

    const [materielEditing, setMaterielEditing] = useState(false);
    const [materielDraft, setMaterielDraft] = useState<Draft>({});
    // Le crayon "Matériel" édite aussi chaque achat existant en même temps
    // (pas que le prévisionnel) — libellé/montant par id, sauvés ensemble.
    const [materielAchatsDraft, setMaterielAchatsDraft] = useState<Record<number, { libelle: string; montant: string }>>({});
    const [personnelEditing, setPersonnelEditing] = useState(false);
    const [personnelDraft, setPersonnelDraft] = useState<Draft>({});

    // Formulaires d'AJOUT d'une nouvelle ligne — indépendants du crayon
    // d'édition ci-dessus, toujours possibles via les boutons "+".
    const [caLigneAdding, setCaLigneAdding] = useState(false);
    const [caLigneDraft, setCaLigneDraft] = useState<CaLigneDraftShape>({ libelle: '', montant: '', heures: '' });
    const [acompteAdding, setAcompteAdding] = useState(false);
    const [acompteDraft, setAcompteDraft] = useState<AcompteDraftShape>({ libelle: '', montant: '', date: new Date().toISOString().split('T')[0] });
    const [achatEditing, setAchatEditing] = useState<number | 'new' | null>(null);
    const [achatDraft, setAchatDraft] = useState({ libelle: '', montant: '', date: '' });

    const fetchData = async () => {
        const res = await api.get(`/api/chantiers/${chantierId}/financier`);
        if (res.ok) setData(await res.json());
    };

    useEffect(() => {
        setLoading(true);
        fetchData().finally(() => setLoading(false));
    }, [chantierId]);

    // Keep this screen honest while it stays open — someone else touching
    // this chantier's finances elsewhere shouldn't need a manual reload to
    // show up here. Paused while any edit form on this screen is active, so
    // a background refetch never yanks values out from under active typing.
    const anyFinanceEditing = caEditing || materielEditing || personnelEditing || caLigneAdding || acompteAdding || achatEditing !== null;
    useAutoRefresh(fetchData, 20000, !anyFinanceEditing);

    const savePrevu = async (draft: Draft, setEditing: (v: boolean) => void) => {
        const f = data!.financier!;
        setSaving(true);
        const body = {
            charge_materiel_prevue: f.charge_materiel_prevue, taux_horaire: f.taux_horaire,
            pct_petites_fournitures: f.pct_petites_fournitures,
            ...Object.fromEntries(Object.entries(draft).map(([k, v]) => [k, parseFloat(v) || 0])),
        };
        const res = await api.put(`/api/chantiers/${chantierId}/financier`, body);
        setSaving(false);
        if (res.ok) { setData(await res.json()); setEditing(false); }
        else { const err = await res.json().catch(() => ({})); alert(err.error || 'Erreur lors de l\'enregistrement'); }
    };

    // --- Chiffre d'affaires : édition groupée (ca_lignes + acomptes) ---
    const startCaEdit = () => {
        setCaLignesEditDraft(Object.fromEntries(data!.ca_lignes.map(l => [l.id, { libelle: l.libelle, montant: String(l.montant), heures: String(l.heures) }])));
        setAcomptesEditDraft(Object.fromEntries(data!.acomptes.map(a => [a.id, { libelle: a.libelle, montant: String(a.montant), date: a.date }])));
        setCaEditing(true);
    };
    const saveCa = async () => {
        setSaving(true);
        for (const [id, draft] of Object.entries(caLignesEditDraft)) {
            const original = data!.ca_lignes.find(l => l.id === Number(id));
            if (!original) continue;
            const montant = parseFloat(draft.montant) || 0;
            const heures = parseFloat(draft.heures) || 0;
            const libelle = draft.libelle.trim();
            if (original.libelle === libelle && original.montant === montant && original.heures === heures) continue;
            const res = await api.put(`/api/chantiers/${chantierId}/ca_lignes/${id}`, { libelle, montant, heures });
            if (!res.ok) {
                setSaving(false);
                const err = await res.json().catch(() => ({}));
                alert(err.error || `Erreur lors de l'enregistrement de la ligne "${libelle}"`);
                return;
            }
        }
        for (const [id, draft] of Object.entries(acomptesEditDraft)) {
            const original = data!.acomptes.find(a => a.id === Number(id));
            if (!original) continue;
            const montant = parseFloat(draft.montant) || 0;
            const libelle = draft.libelle.trim();
            if (original.libelle === libelle && original.montant === montant && original.date === draft.date) continue;
            const res = await api.put(`/api/chantiers/${chantierId}/acomptes/${id}`, { libelle, montant, date: draft.date });
            if (!res.ok) {
                setSaving(false);
                const err = await res.json().catch(() => ({}));
                alert(err.error || `Erreur lors de l'enregistrement de l'acompte "${libelle}"`);
                return;
            }
        }
        await fetchData();
        setSaving(false);
        setCaEditing(false);
    };

    const startMaterielEdit = () => {
        setMaterielDraft(toDraft(data!.financier!, ['charge_materiel_prevue', 'pct_petites_fournitures']));
        // Chaque achat existant (hors ligne auto) devient éditable en même
        // temps que le prévisionnel — plus besoin de cliquer chaque ligne.
        setMaterielAchatsDraft(Object.fromEntries(
            data!.achats.filter(a => a.type !== 'estimation_petites_fournitures')
                .map(a => [a.id, { libelle: a.libelle, montant: String(a.montant) }])
        ));
        setMaterielEditing(true);
    };
    const startPersonnelEdit = () => { setPersonnelDraft(toDraft(data!.financier!, ['taux_horaire'])); setPersonnelEditing(true); };

    // Sauvegarde groupée du crayon "Matériel" : le prévisionnel (PUT unique)
    // puis chaque achat modifié (un PUT par achat — pas de route bulk côté
    // API), en séquence pour rester simple et éviter les races sur data.
    const saveMateriel = async () => {
        setSaving(true);
        const fin = data!.financier!;
        const body = {
            charge_materiel_prevue: parseFloat(materielDraft.charge_materiel_prevue) || 0,
            taux_horaire: fin.taux_horaire,
            pct_petites_fournitures: parseFloat(materielDraft.pct_petites_fournitures) || 0,
        };
        const res = await api.put(`/api/chantiers/${chantierId}/financier`, body);
        if (!res.ok) {
            setSaving(false);
            const err = await res.json().catch(() => ({}));
            alert(err.error || 'Erreur lors de l\'enregistrement');
            return;
        }
        for (const [id, draft] of Object.entries(materielAchatsDraft)) {
            const original = data!.achats.find(a => a.id === Number(id));
            if (!original) continue; // supprimé entre-temps
            const montant = parseFloat(draft.montant) || 0;
            const libelle = draft.libelle.trim();
            if (original.libelle === libelle && original.montant === montant) continue; // rien changé
            const res2 = await api.put(`/api/chantiers/${chantierId}/achats/${id}`, { libelle, montant });
            if (!res2.ok) {
                setSaving(false);
                const err = await res2.json().catch(() => ({}));
                alert(err.error || `Erreur lors de l'enregistrement de l'achat "${libelle}"`);
                return;
            }
        }
        await fetchData();
        setSaving(false);
        setMaterielEditing(false);
    };

    // --- Ajout d'une nouvelle ligne CA ---
    const startCaLigneAdd = () => { setCaLigneDraft({ libelle: '', montant: '', heures: '' }); setCaLigneAdding(true); };
    const saveCaLigneAdd = async () => {
        setSaving(true);
        const body = { libelle: caLigneDraft.libelle.trim(), montant: parseFloat(caLigneDraft.montant) || 0, heures: parseFloat(caLigneDraft.heures) || 0 };
        const res = await api.post(`/api/chantiers/${chantierId}/ca_lignes`, body);
        setSaving(false);
        if (res.ok) { await fetchData(); setCaLigneAdding(false); }
        else { const err = await res.json().catch(() => ({})); alert(err.error || 'Erreur lors de l\'enregistrement'); }
    };
    const deleteCaLigne = async (l: CaLignePrevue) => {
        if (!confirm(`Supprimer la ligne "${l.libelle}" ?`)) return;
        setBusyId(l.id);
        const res = await api.delete(`/api/chantiers/${chantierId}/ca_lignes/${l.id}`);
        setBusyId(null);
        if (res.ok) fetchData(); else alert('Erreur lors de la suppression');
    };

    // --- Ajout d'un nouvel acompte ---
    const startAcompteAdd = () => { setAcompteDraft({ libelle: '', montant: '', date: new Date().toISOString().split('T')[0] }); setAcompteAdding(true); };
    const saveAcompteAdd = async () => {
        setSaving(true);
        const body = { libelle: acompteDraft.libelle.trim(), montant: parseFloat(acompteDraft.montant) || 0, date: acompteDraft.date };
        const res = await api.post(`/api/chantiers/${chantierId}/acomptes`, body);
        setSaving(false);
        if (res.ok) { await fetchData(); setAcompteAdding(false); }
        else { const err = await res.json().catch(() => ({})); alert(err.error || 'Erreur lors de l\'enregistrement'); }
    };
    const deleteAcompte = async (a: Acompte) => {
        if (!confirm(`Supprimer l'acompte "${a.libelle}" ?`)) return;
        setBusyId(a.id);
        const res = await api.delete(`/api/chantiers/${chantierId}/acomptes/${a.id}`);
        setBusyId(null);
        if (res.ok) fetchData(); else alert('Erreur lors de la suppression');
    };

    // --- Achats ---
    const startAchatAdd = () => { setAchatDraft({ libelle: '', montant: '', date: '' }); setAchatEditing('new'); };
    const startAchatEdit = (a: AchatMateriel) => { setAchatDraft({ libelle: a.libelle, montant: String(a.montant), date: a.date || '' }); setAchatEditing(a.id); };
    const saveAchat = async () => {
        setSaving(true);
        const body: Record<string, unknown> = { libelle: achatDraft.libelle.trim(), montant: parseFloat(achatDraft.montant) || 0 };
        if (achatDraft.date) body.date = achatDraft.date;
        const res = achatEditing === 'new'
            ? await api.post(`/api/chantiers/${chantierId}/achats`, body)
            : await api.put(`/api/chantiers/${chantierId}/achats/${achatEditing}`, body);
        setSaving(false);
        if (res.ok) { await fetchData(); setAchatEditing(null); }
        else { const err = await res.json().catch(() => ({})); alert(err.error || 'Erreur lors de l\'enregistrement'); }
    };
    const deleteAchat = async (a: AchatMateriel) => {
        if (!confirm(`Supprimer l'achat "${a.libelle}" ?`)) return;
        setBusyId(a.id);
        const res = await api.delete(`/api/chantiers/${chantierId}/achats/${a.id}`);
        setBusyId(null);
        if (res.ok) {
            // Retire aussi son brouillon s'il était en cours d'édition via le
            // crayon "Matériel", sinon la sauvegarde groupée le chercherait
            // encore et échouerait sur un id qui n'existe plus.
            setMaterielAchatsDraft(prev => { const { [a.id]: _, ...rest } = prev; return rest; });
            fetchData();
        } else alert('Erreur lors de la suppression');
    };

    if (loading) {
        return <div className="flex items-center justify-center py-16 text-slate-400"><Loader2 className="animate-spin" /></div>;
    }
    if (!data || !data.financier) {
        return <FirstTimeSetup chantierId={chantierId} onCreated={setData} />;
    }

    const f = data.financier;
    const margeReelle = data.marge_reelle ?? 0;
    const margePositive = margeReelle >= 0;
    const ecartHeures = data.ecart_heures ?? 0;
    const heuresPrevues = data.heures_prevues ?? 0;
    const depassement = ecartHeures > 0;
    const depassementFort = depassement && heuresPrevues > 0 && (ecartHeures / heuresPrevues) > 0.10;
    const ecartDebourseSec = (data.debourse_sec_reel ?? 0) - (data.debourse_sec_prevu ?? 0);

    // Nombre de lignes CA prévu / acomptes / achats — chaque colonne grandit
    // indépendamment de l'autre, chacune rendue dans sa propre boucle de <tr>.
    const caLigneRowsCount = Math.max(data.ca_lignes.length + (caLigneAdding ? 1 : 0), 1);
    const acompteRowsCount = Math.max(data.acomptes.length + (acompteAdding ? 1 : 0), 1);
    const achatRowsCount = Math.max(data.achats.length + (achatEditing === 'new' ? 1 : 0), 1);
    const caRowsCount = Math.max(caLigneRowsCount, acompteRowsCount);

    return (
        <div className="space-y-6 animate-slide-up">
            {/* ===== SYNCHRO VOLTA ===== */}
            <VoltaLinksSection chantierId={chantierId} />

            {/* En-tête — indicateur de marge réelle */}
            <div className={`card flex items-center justify-between gap-4 border-l-4 ${margePositive ? 'border-l-green-500' : 'border-l-red-500'}`}>
                <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-widest mb-1">Marge réelle</div>
                    <div className={`text-3xl font-black ${margePositive ? 'text-green-600' : 'text-red-500'}`}>
                        {formatCHF(data.marge_reelle)} <span className="text-lg">CHF</span>
                        <span className="text-base font-bold ml-2 opacity-70">{formatPct(data.pct_marge_reelle)}</span>
                    </div>
                </div>
                <div className={`w-14 h-14 rounded-2xl flex items-center justify-center shrink-0 ${margePositive ? 'bg-green-500/10 text-green-600' : 'bg-red-500/10 text-red-500'}`}>
                    {margePositive ? <TrendingUp size={26} /> : <TrendingDown size={26} />}
                </div>
            </div>

            {/* Avancement — 4 formules calculées depuis le budget, + l'avancement
                physique déclaré à la main (voir le bouton dans l'en-tête de la
                fiche chantier) pour comparer "où on en est vraiment" vs budget. */}
            <div className="card">
                <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-5">Avancement</h4>
                <div className="grid grid-cols-2 sm:grid-cols-5 gap-6">
                    <DonutStat
                        label="Déclaré (chantier)"
                        pct={avancementDeclare != null ? avancementDeclare / 100 : null}
                        colorOverride={avancementDeclare != null ? '#2563eb' : undefined}
                    />
                    <DonutStat label="Chiffre d'affaires" pct={data.pct_avancement_ca ?? null} />
                    <DonutStat label="Matériel" pct={data.pct_avancement_materiel ?? null} />
                    <DonutStat label="Main d'œuvre" pct={data.pct_avancement_mo ?? null} />
                    <DonutStat label="Débours sec" pct={data.pct_avancement_debourse_sec ?? null} />
                </div>
                {avancementDeclare == null && (
                    <p className="text-[11px] text-slate-400 mt-4 italic">
                        Avancement déclaré non renseigné — utilisez le bouton dans l'en-tête de la fiche chantier pour l'indiquer.
                    </p>
                )}
            </div>

            {depassement && (
                <div className={`card flex items-start gap-3 border-l-4 ${depassementFort ? 'border-l-red-500 bg-red-50/50' : 'border-l-amber-400 bg-amber-50/50'}`}>
                    <AlertTriangle size={20} className={`shrink-0 mt-0.5 ${depassementFort ? 'text-red-500' : 'text-amber-500'}`} />
                    <div className="text-sm">
                        <div className={`font-bold ${depassementFort ? 'text-red-700' : 'text-amber-700'}`}>
                            Ce chantier consomme plus d'heures que prévu (+{formatHeures(ecartHeures)} h)
                        </div>
                        <div className="text-slate-500 text-xs mt-0.5">Vérifier s'il faut facturer en régie ou en plus-value client supplémentaire.</div>
                    </div>
                </div>
            )}

            {/* Légende couleur */}
            <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 px-1 text-[11px] font-medium text-slate-500">
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-blue-200 border border-blue-300" /> Champ modifiable</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-slate-300 border border-slate-400" /> Calculé automatiquement</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-green-500" /> Mieux que prévu</span>
                <span className="inline-flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-red-500" /> Moins bien que prévu / heures manquantes</span>
            </div>

            {/* ===== CHIFFRE AFFAIRES ===== */}
            <SectionCard>
                <TopHeader />
                <SectionTitle title="Chiffre affaires" action={
                    <SectionEditToggle editing={caEditing} saving={saving} onEdit={startCaEdit} onCancel={() => setCaEditing(false)} onSave={saveCa} />
                } />
                <SubHeader a="CA" b="Heures" />

                {Array.from({ length: caRowsCount }).map((_, i) => {
                    const ligne = data.ca_lignes[i];
                    const isCaLigneAddRow = i === data.ca_lignes.length && caLigneAdding;
                    const acompte = data.acomptes[i];
                    const isAcompteAddRow = i === data.acomptes.length && acompteAdding;
                    // Heures prévues à 0 sur une ligne CA = pas encore chiffrées côté
                    // devis alors qu'il y a un montant — toute la cellule passe rouge.
                    const heuresVides = ligne && ligne.montant > 0 && ligne.heures === 0;
                    return (
                        <tr key={`ca-${i}`} className="hover:bg-slate-50/50">
                            {ligne && caEditing ? (
                                <>
                                    <Td className={FIELD}>
                                        <input type="text" value={caLignesEditDraft[ligne.id]?.libelle ?? ''}
                                            onChange={e => setCaLignesEditDraft({ ...caLignesEditDraft, [ligne.id]: { ...caLignesEditDraft[ligne.id], libelle: e.target.value } })}
                                            className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right ${FIELD}`}>
                                        <input type="number" step="0.01" min="0" value={caLignesEditDraft[ligne.id]?.montant ?? ''}
                                            onChange={e => setCaLignesEditDraft({ ...caLignesEditDraft, [ligne.id]: { ...caLignesEditDraft[ligne.id], montant: e.target.value } })}
                                            className="w-full px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right group ${FIELD}`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            <input type="number" step="0.5" min="0" value={caLignesEditDraft[ligne.id]?.heures ?? ''}
                                                onChange={e => setCaLignesEditDraft({ ...caLignesEditDraft, [ligne.id]: { ...caLignesEditDraft[ligne.id], heures: e.target.value } })}
                                                className="w-14 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs bg-white" />
                                            <button onClick={() => deleteCaLigne(ligne)} disabled={busyId === ligne.id} className="text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Supprimer"><Trash2 size={12} /></button>
                                        </span>
                                    </Td>
                                </>
                            ) : ligne ? (
                                <>
                                    <Td className="font-medium text-slate-700 truncate max-w-[140px]">{ligne.libelle}</Td>
                                    <Td className="text-right">{formatCHF(ligne.montant)}</Td>
                                    <Td className={`text-right font-bold ${heuresVides ? 'bg-red-100 text-red-600' : ''}`} title={heuresVides ? 'Heures pas encore chiffrées pour cette ligne' : undefined}>
                                        {formatHeures(ligne.heures)}
                                    </Td>
                                </>
                            ) : isCaLigneAddRow ? (
                                <>
                                    <Td className={FIELD}>
                                        <input type="text" autoFocus placeholder="Libellé" value={caLigneDraft.libelle} onChange={e => setCaLigneDraft({ ...caLigneDraft, libelle: e.target.value })}
                                            className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right ${FIELD}`}>
                                        <input type="number" step="0.01" min="0" placeholder="Montant" value={caLigneDraft.montant} onChange={e => setCaLigneDraft({ ...caLigneDraft, montant: e.target.value })}
                                            className="w-full px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right ${FIELD}`}>
                                        <span className="inline-flex items-center gap-1">
                                            <input type="number" step="0.5" min="0" placeholder="Heures" value={caLigneDraft.heures} onChange={e => setCaLigneDraft({ ...caLigneDraft, heures: e.target.value })}
                                                className="w-14 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs bg-white" />
                                            <button onClick={() => setCaLigneAdding(false)} disabled={saving} className="p-0.5 text-slate-400 hover:text-red-500 shrink-0"><X size={12} /></button>
                                            <button onClick={saveCaLigneAdd} disabled={saving || !caLigneDraft.libelle.trim() || !caLigneDraft.montant} className="p-0.5 text-green-600 shrink-0 disabled:opacity-30">{saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}</button>
                                        </span>
                                    </Td>
                                </>
                            ) : (<><Blank /><Blank /><Blank /></>)}

                            {acompte && caEditing ? (
                                <>
                                    <Td className={FIELD}>
                                        <input type="text" value={acomptesEditDraft[acompte.id]?.libelle ?? ''}
                                            onChange={e => setAcomptesEditDraft({ ...acomptesEditDraft, [acompte.id]: { ...acomptesEditDraft[acompte.id], libelle: e.target.value } })}
                                            className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right ${FIELD}`}>
                                        <div className="flex items-center gap-1 flex-wrap justify-end">
                                            <input type="number" step="0.01" min="0" value={acomptesEditDraft[acompte.id]?.montant ?? ''}
                                                onChange={e => setAcomptesEditDraft({ ...acomptesEditDraft, [acompte.id]: { ...acomptesEditDraft[acompte.id], montant: e.target.value } })}
                                                className="w-16 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right font-mono text-xs bg-white" />
                                            <input type="date" value={acomptesEditDraft[acompte.id]?.date ?? ''}
                                                onChange={e => setAcomptesEditDraft({ ...acomptesEditDraft, [acompte.id]: { ...acomptesEditDraft[acompte.id], date: e.target.value } })}
                                                className="w-24 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-[11px] bg-white shrink-0" />
                                            <button onClick={() => deleteAcompte(acompte)} disabled={busyId === acompte.id} className="text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Supprimer"><Trash2 size={12} /></button>
                                        </div>
                                    </Td>
                                </>
                            ) : acompte ? (
                                <>
                                    <Td className="text-slate-700 truncate max-w-[140px]">{acompte.libelle}</Td>
                                    <Td className="text-right">{formatCHF(acompte.montant)}</Td>
                                </>
                            ) : isAcompteAddRow ? (
                                <AcompteInlineCells draft={acompteDraft} setDraft={setAcompteDraft} onSave={saveAcompteAdd} onCancel={() => setAcompteAdding(false)} saving={saving} isNew />
                            ) : (<><Blank /><Blank /></>)}
                        </tr>
                    );
                })}

                {!caEditing && (
                    <tr>
                        <Td colSpan={3}>
                            {!caLigneAdding && (
                                <button onClick={startCaLigneAdd} className="inline-flex items-center gap-1 text-ohm-primary font-bold text-[11px] hover:underline"><Plus size={11} /> Ligne CA</button>
                            )}
                        </Td>
                        <Td colSpan={2}>
                            {!acompteAdding && (
                                <button onClick={startAcompteAdd} className="inline-flex items-center gap-1 text-ohm-primary font-bold text-[11px] hover:underline"><Plus size={11} /> Acompte</button>
                            )}
                        </Td>
                        <Blank />
                    </tr>
                )}

                <tr className={`${RESULT} font-black`}>
                    <Td>TOTAL</Td>
                    <Td className="text-right">{formatCHF(data.ca_prevu)}</Td>
                    <Td className="text-right">{formatHeures(data.heures_prevues)}</Td>
                    <Td>Facturé</Td>
                    <Td className="text-right">{formatCHF(data.ca_reel)}</Td>
                    <Td className={`text-right ${signColor(data.reste_a_facturer)}`} title="Reste à facturer">{formatCHF(data.reste_a_facturer)}</Td>
                </tr>
            </SectionCard>

            {/* ===== MATERIEL ===== */}
            <SectionCard>
                <TopHeader />
                <SectionTitle title="Matériel" action={
                    <SectionEditToggle editing={materielEditing} saving={saving} onEdit={startMaterielEdit} onCancel={() => setMaterielEditing(false)} onSave={saveMateriel} />
                } />

                {Array.from({ length: Math.max(1, achatRowsCount) }).map((_, i) => {
                    const achat = data.achats[i];
                    const isAchatAddRow = i === data.achats.length && achatEditing === 'new';
                    const rows = Math.max(1, achatRowsCount);
                    return (
                        <tr key={`mat-${i}`} className="hover:bg-slate-50/50">
                            {/* Prévu matériel : une seule vraie ligne (variable fournitures) —
                                fusionnée sur toute la hauteur de la liste d'achats au lieu de
                                répéter des cellules vides en dessous. */}
                            {i === 0 && (
                                <>
                                    <Td rowSpan={rows} className="font-medium text-slate-700 whitespace-nowrap align-top">variable fournitures</Td>
                                    <Td rowSpan={rows} className={`text-right align-top ${FIELD}`}><NumCell editing={materielEditing} value={materielDraft.pct_petites_fournitures ?? ''} onChange={v => setMaterielDraft({ ...materielDraft, pct_petites_fournitures: v })} step="0.01" placeholder="0.05" formatted={formatPct(f.pct_petites_fournitures)} /></Td>
                                    <td rowSpan={rows} className="px-2.5 py-1.5">&nbsp;</td>
                                </>
                            )}

                            {achat && materielEditing && achat.type !== 'estimation_petites_fournitures' ? (
                                // Crayon "Matériel" actif : chaque achat existant est éditable
                                // directement ici, pas juste supprimable — sauvé avec le prévisionnel.
                                <>
                                    <Td className={FIELD}>
                                        <input type="text" value={materielAchatsDraft[achat.id]?.libelle ?? ''}
                                            onChange={e => setMaterielAchatsDraft({ ...materielAchatsDraft, [achat.id]: { ...materielAchatsDraft[achat.id], libelle: e.target.value } })}
                                            className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
                                    </Td>
                                    <Td className={`text-right group ${FIELD}`}>
                                        <span className="inline-flex items-center gap-1.5 justify-end">
                                            <input type="number" step="0.01" min="0" inputMode="decimal" value={materielAchatsDraft[achat.id]?.montant ?? ''}
                                                onChange={e => setMaterielAchatsDraft({ ...materielAchatsDraft, [achat.id]: { ...materielAchatsDraft[achat.id], montant: e.target.value } })}
                                                className="w-20 px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right text-xs bg-white" />
                                            <button onClick={() => deleteAchat(achat)} disabled={busyId === achat.id} className="text-slate-300 hover:text-red-500 transition-colors shrink-0" title="Supprimer"><Trash2 size={12} /></button>
                                        </span>
                                    </Td>
                                </>
                            ) : achat && achatEditing === achat.id ? (
                                <AchatInlineCells draft={achatDraft} setDraft={setAchatDraft} onSave={saveAchat} onCancel={() => setAchatEditing(null)} saving={saving} />
                            ) : achat ? (
                                <>
                                    <Td className="text-slate-700 truncate max-w-[160px]">
                                        {achat.type === 'estimation_petites_fournitures'
                                            ? <span className="italic text-slate-400">{achat.libelle} (auto)</span>
                                            : <button onClick={() => startAchatEdit(achat)} className="text-left hover:text-ohm-primary transition-colors truncate w-full" title="Modifier">{achat.libelle}</button>}
                                    </Td>
                                    <Td className={`text-right group ${achat.type === 'estimation_petites_fournitures' ? 'italic text-slate-400' : ''}`}>
                                        <span className="inline-flex items-center gap-1.5">
                                            {formatCHF(achat.montant)}
                                            {achat.type !== 'estimation_petites_fournitures' && (
                                                <button onClick={() => deleteAchat(achat)} disabled={busyId === achat.id} className="opacity-0 group-hover:opacity-100 text-slate-300 hover:text-red-500 transition-opacity" title="Supprimer"><Trash2 size={12} /></button>
                                            )}
                                        </span>
                                    </Td>
                                </>
                            ) : isAchatAddRow ? (
                                <AchatInlineCells draft={achatDraft} setDraft={setAchatDraft} onSave={saveAchat} onCancel={() => setAchatEditing(null)} saving={saving} isNew />
                            ) : (<><Blank /><Blank /></>)}

                            {i === 0 && <Td rowSpan={rows} className="text-center align-top">
                                {achatEditing === null && !materielEditing && (
                                    <button onClick={startAchatAdd} className="inline-flex items-center gap-1 text-ohm-primary font-bold text-[11px] hover:underline"><Plus size={11} /> Achat</button>
                                )}
                            </Td>}
                        </tr>
                    );
                })}

                <tr className="font-black">
                    <Td>Charge matériel HT</Td>
                    <Td className={`text-right ${FIELD}`} colSpan={2}><NumCell editing={materielEditing} value={materielDraft.charge_materiel_prevue ?? ''} onChange={v => setMaterielDraft({ ...materielDraft, charge_materiel_prevue: v })} formatted={formatCHF(f.charge_materiel_prevue)} /></Td>
                    <Td className={RESULT}>Total achats</Td>
                    <Td className={`text-right ${RESULT}`}>{formatCHF(data.total_achats_reel)}</Td>
                    <Td className={`text-right ${signColor(data.ecart_materiel)}`} title="Reste à dépenser">{formatCHF(data.ecart_materiel)}</Td>
                </tr>
            </SectionCard>

            {/* ===== PERSONNEL ===== */}
            <SectionCard>
                <TopHeader />
                <SectionTitle title="Personnel" action={
                    <SectionEditToggle editing={personnelEditing} saving={saving} onEdit={startPersonnelEdit} onCancel={() => setPersonnelEditing(false)} onSave={() => savePrevu(personnelDraft, setPersonnelEditing)} />
                } />
                <tr>
                    <Td colSpan={2} className="text-slate-400 text-[10px] uppercase font-bold">Taux horaire</Td>
                    <Td className={`text-right ${FIELD}`}><NumCell editing={personnelEditing} value={personnelDraft.taux_horaire ?? ''} onChange={v => setPersonnelDraft({ ...personnelDraft, taux_horaire: v })} formatted={formatCHF(f.taux_horaire)} /></Td>
                    <Td colSpan={2} className="text-slate-400 text-[10px] uppercase font-bold text-right">Écart réalisé / prévu</Td>
                    <Blank />
                </tr>
                <tr>
                    <Td className="font-medium text-slate-700">Heures prévues</Td>
                    <Td className={`text-right font-bold ${RESULT}`} colSpan={2}>{formatHeures(data.heures_prevues)}</Td>
                    <Td className={RESULT}>Total heures</Td>
                    <Td className={`text-right font-bold ${RESULT}`}>{formatHeures(data.heures_reelles)}</Td>
                    <Td className={`text-right font-bold ${signColor(data.ecart_heures, true)}`}>{formatHeures(data.ecart_heures)}</Td>
                </tr>
                <tr>
                    <Td className="font-medium text-slate-700">Coût main d'œuvre</Td>
                    <Td className={`text-right font-black ${RESULT}`} colSpan={2}>{formatCHF(data.cout_mo_prevu)}</Td>
                    <Td className={`font-black ${RESULT}`}>Total MOD</Td>
                    <Td className={`text-right font-black ${RESULT}`}>{formatCHF(data.cout_mo_reel)}</Td>
                    <Td className={`text-right font-black ${signColor(data.ecart_cout_mo, true)}`}>{formatCHF(data.ecart_cout_mo)}</Td>
                </tr>
            </SectionCard>

            {/* ===== DÉBOURS SEC & MARGE ===== (coût direct = MO + matériel, et ce qu'il en reste en marge) */}
            <SectionCard>
                <TopHeader />
                <SectionTitle title="Débours sec & marge" />
                <tr className={RESULT}>
                    <Td colSpan={2}>Débours sec (MO + matériel)</Td>
                    <Td className="text-right font-bold">{formatCHF(data.debourse_sec_prevu)}</Td>
                    <Td colSpan={2}>Débours sec (MO + matériel)</Td>
                    <Td className="text-right font-bold">{formatCHF(data.debourse_sec_reel)}</Td>
                </tr>
                <tr>
                    <Td colSpan={5} className={`text-right text-[10px] uppercase font-bold text-slate-400 ${RESULT}`}>Écart débours sec</Td>
                    <Td className={`text-right font-bold ${signColor(ecartDebourseSec, true)}`}>{formatCHF(ecartDebourseSec)}</Td>
                </tr>
                <tr className={`${RESULT} font-black text-sm`}>
                    <Td colSpan={1}>Marge prévue</Td>
                    <Td className="text-right" colSpan={1}>{formatCHF(data.marge_prevue)}</Td>
                    <Td className="text-right font-normal text-slate-500" colSpan={1}>{formatPct(data.pct_marge_prevue)}</Td>
                    <Td colSpan={1}>Marge réalisée</Td>
                    <Td className={`text-right ${signColor(data.marge_reelle)}`}>{formatCHF(data.marge_reelle)} <span className="font-normal text-slate-500">({formatPct(data.pct_marge_reelle)})</span></Td>
                    <Td className={`text-right ${signColor(data.ecart_marge)}`}>{formatCHF(data.ecart_marge)}</Td>
                </tr>
            </SectionCard>
        </div>
    );
};

// Ligne d'ajout d'un nouvel acompte — remplace directement la ligne dans le
// tableau, jamais de fenêtre à côté. (Édition d'un acompte existant : voir
// le crayon "Chiffre affaires", pas cette forme.)
const AcompteInlineCells: React.FC<{
    draft: { libelle: string; montant: string; date: string };
    setDraft: (d: { libelle: string; montant: string; date: string }) => void;
    onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean;
}> = ({ draft, setDraft, onSave, onCancel, saving, isNew }) => (
    <>
        <Td className="bg-ohm-primary/5">
            <input type="text" autoFocus placeholder="Libellé" value={draft.libelle} onChange={e => setDraft({ ...draft, libelle: e.target.value })}
                className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
        </Td>
        <Td className="bg-ohm-primary/5">
            <div className="flex items-center gap-1 flex-wrap">
                <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="Montant" value={draft.montant} onChange={e => setDraft({ ...draft, montant: e.target.value })}
                    className="w-16 px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right text-xs bg-white" />
                <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })} required
                    className="w-24 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-[11px] bg-white shrink-0" />
                <button onClick={onCancel} disabled={saving} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 shrink-0" title="Annuler"><X size={12} /></button>
                <button onClick={onSave} disabled={saving || !draft.libelle.trim() || !draft.montant} className="p-1 rounded text-green-600 hover:bg-green-500/10 disabled:opacity-30 shrink-0" title={isNew ? 'Ajouter' : 'Enregistrer'}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                </button>
            </div>
        </Td>
    </>
);

// Idem pour une ligne achat (pas d'heures, date optionnelle).
const AchatInlineCells: React.FC<{
    draft: { libelle: string; montant: string; date: string };
    setDraft: (d: { libelle: string; montant: string; date: string }) => void;
    onSave: () => void; onCancel: () => void; saving: boolean; isNew?: boolean;
}> = ({ draft, setDraft, onSave, onCancel, saving, isNew }) => (
    <>
        <Td className="bg-ohm-primary/5">
            <input type="text" autoFocus placeholder="Libellé" value={draft.libelle} onChange={e => setDraft({ ...draft, libelle: e.target.value })}
                className="w-full px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-xs bg-white" />
        </Td>
        <Td className="bg-ohm-primary/5">
            <div className="flex items-center gap-1">
                <input type="number" step="0.01" min="0" inputMode="decimal" placeholder="Montant" value={draft.montant} onChange={e => setDraft({ ...draft, montant: e.target.value })}
                    className="w-16 px-1.5 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-right text-xs bg-white" />
                <input type="date" value={draft.date} onChange={e => setDraft({ ...draft, date: e.target.value })}
                    className="w-24 px-1 py-0.5 rounded border border-ohm-primary/60 focus:border-ohm-primary focus:outline-none text-[11px] bg-white shrink-0" />
                <button onClick={onCancel} disabled={saving} className="p-1 rounded text-slate-400 hover:text-red-500 hover:bg-red-500/10 disabled:opacity-50 shrink-0" title="Annuler"><X size={12} /></button>
                <button onClick={onSave} disabled={saving || !draft.libelle.trim() || !draft.montant} className="p-1 rounded text-green-600 hover:bg-green-500/10 disabled:opacity-30 shrink-0" title={isNew ? 'Ajouter' : 'Enregistrer'}>
                    {saving ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
                </button>
            </div>
        </Td>
    </>
);

const FirstTimeSetup: React.FC<{ chantierId: number; onCreated: (d: FinancierPayload) => void }> = ({ chantierId, onCreated }) => {
    const [saving, setSaving] = useState(false);

    const create = async () => {
        setSaving(true);
        const res = await api.put(`/api/chantiers/${chantierId}/financier`, {});
        setSaving(false);
        if (res.ok) onCreated(await res.json());
        else { const err = await res.json().catch(() => ({})); alert(err.error || 'Erreur lors de l\'enregistrement'); }
    };

    return (
        <div className="space-y-4">
            <div className="card text-center py-12 text-slate-400 italic">Aucune donnée financière configurée pour ce chantier.</div>
            <button onClick={create} disabled={saving} className="w-full py-3 bg-ohm-primary text-ohm-bg font-black rounded-xl hover:bg-yellow-300 transition-all flex items-center justify-center gap-2 text-sm uppercase tracking-widest disabled:opacity-50">
                {saving ? <Loader2 size={18} className="animate-spin" /> : <Plus size={18} />} Configurer le prévisionnel
            </button>
        </div>
    );
};

// --- Synchro Volta : formulaire de rattachement + liste des entrées de ce
// chantier (voir backend VoltaDocumentLink / process_volta_sync_queue). Une
// entrée créée ici part 'en_attente' — c'est le worker (déclenché à part)
// qui la synchronise ensuite ; ce composant ne fait qu'ajouter/lister.
const VoltaLinksSection: React.FC<{ chantierId: number }> = ({ chantierId }) => {
    const [links, setLinks] = useState<VoltaDocumentLink[]>([]);
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [draft, setDraft] = useState({ numero_projet: '', numero_facture: '', numero_offre: '' });
    const [error, setError] = useState<string | null>(null);

    const fetchLinks = async () => {
        const res = await api.get(`/api/chantiers/${chantierId}/volta-links`);
        if (res.ok) setLinks(await res.json());
    };

    useEffect(() => {
        setLoading(true);
        fetchLinks().finally(() => setLoading(false));
    }, [chantierId]);

    const submit = async () => {
        setError(null);
        if (!draft.numero_projet.trim() || !draft.numero_facture.trim()) {
            setError('Numéro de projet et numéro de facture sont obligatoires.');
            return;
        }
        setSaving(true);
        const res = await api.post(`/api/chantiers/${chantierId}/volta-links`, {
            numero_projet: draft.numero_projet.trim(),
            numero_facture: draft.numero_facture.trim(),
            numero_offre: draft.numero_offre.trim() || null,
        });
        setSaving(false);
        if (res.ok) {
            setDraft({ numero_projet: '', numero_facture: '', numero_offre: '' });
            await fetchLinks();
        } else {
            const err = await res.json().catch(() => ({}));
            setError(err.error || "Erreur lors de l'enregistrement");
        }
    };

    const statusLabel = (link: VoltaDocumentLink) => {
        if (link.statut_sync === 'synced') {
            const date = link.derniere_sync_at
                ? new Date(link.derniere_sync_at).toLocaleDateString('fr-CH', { day: '2-digit', month: '2-digit', year: 'numeric' })
                : null;
            return <span className="text-green-600 font-bold text-xs">Synchronisé{date ? ` le ${date}` : ''}</span>;
        }
        if (link.statut_sync === 'erreur') {
            return <span className="text-red-500 font-bold text-xs">Erreur — {link.erreur_message || 'raison inconnue'}</span>;
        }
        return <span className="text-slate-400 font-bold text-xs">En attente</span>;
    };

    return (
        <div className="card">
            <h4 className="text-sm font-black text-slate-900 uppercase tracking-wide mb-1">Synchro Volta</h4>
            <p className="text-xs text-slate-400 mb-4">
                Rattache une facture (et, si connue, l'offre correspondante) à ce chantier — synchronisée ensuite via la file d'attente Volta.
            </p>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Numéro de projet</label>
                    <input
                        type="text" placeholder="ex. 024042.001" value={draft.numero_projet}
                        onChange={e => setDraft({ ...draft, numero_projet: e.target.value })}
                        className="input-field mt-1 !py-2 text-sm"
                    />
                </div>
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Numéro de facture</label>
                    <input
                        type="text" placeholder="ex. 7098" value={draft.numero_facture}
                        onChange={e => setDraft({ ...draft, numero_facture: e.target.value })}
                        className="input-field mt-1 !py-2 text-sm"
                    />
                </div>
                <div>
                    <label className="text-[11px] font-bold text-slate-400 uppercase tracking-wide">Numéro d'offre (optionnel)</label>
                    <input
                        type="text" placeholder="ex. 7747" value={draft.numero_offre}
                        onChange={e => setDraft({ ...draft, numero_offre: e.target.value })}
                        className="input-field mt-1 !py-2 text-sm"
                    />
                </div>
            </div>

            {error && <p className="text-xs text-red-500 mt-2">{error}</p>}

            <button
                onClick={submit} disabled={saving}
                className="mt-3 inline-flex items-center gap-2 bg-ohm-primary text-ohm-bg font-black rounded-xl px-5 py-2 text-xs uppercase tracking-widest hover:bg-yellow-300 transition-all disabled:opacity-50"
            >
                {saving ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />} Valider
            </button>

            {loading ? (
                <div className="mt-4 text-slate-400 text-xs">Chargement…</div>
            ) : links.length > 0 && (
                <div className="mt-5 pt-4 border-t border-slate-100 space-y-2">
                    {links.map(link => (
                        <div key={link.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-xs sm:text-sm">
                            <span className="font-mono text-slate-600">
                                Projet {link.numero_projet} · Facture {link.numero_facture}
                                {link.numero_offre && <> · Offre {link.numero_offre}</>}
                            </span>
                            {statusLabel(link)}
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};
