import React, { useEffect, useMemo, useState } from 'react';
import { X, Pencil, Trash2, Search, CheckSquare, Plus, CalendarCheck, MapPin, FolderOpen } from 'lucide-react';
import { CalendarItem, Chantier, User } from '../types';
import { LEAVE_TYPE_OPTIONS, LEAVE_TYPE_LABELS } from '../leaveTypes';
import { AwesomeSelect } from './ui/AwesomeSelect';
import { AwesomeDatePicker } from './ui/AwesomeDatePicker';
import { InlineSearchSelect } from './ui/InlineSearchSelect';
import { StatusBadge } from './StatusBadge';
import { api } from '../api';

export type EntryType = 'CHANTIER' | (typeof LEAVE_TYPE_OPTIONS)[number]['value'];

// One candidate date range in a "chantier à planifier" submission — each
// carries its OWN toute_la_journee/heures, independent of the others (one
// candidate can be a full day, another a specific morning slot).
export interface CandidateRange {
    dateDebut: string;
    dateFin: string;
    touteLaJournee: boolean;
    heureDebut: string;
    heureFin: string;
}

export interface AgendaFormValues {
    entryType: EntryType;
    chantierId: string;
    description: string;
    dateDebut: string;
    dateFin: string;
    touteLaJournee: boolean;
    heureDebut: string;
    heureFin: string;
    userIds: number[];
    // "Chantier à planifier" — only meaningful for entryType='CHANTIER' in
    // create mode. When true, `candidates` replaces the single dateDebut/
    // dateFin/touteLaJournee/heure* fields above for submission.
    aPlanifier: boolean;
    candidates: CandidateRange[];
}

const emptyCandidate = (dateDebut: string): CandidateRange => ({
    dateDebut, dateFin: dateDebut, touteLaJournee: true, heureDebut: '08:00', heureFin: '09:00',
});

export const emptyFormValues = (dateDebut: string, userIds: number[] = []): AgendaFormValues => ({
    entryType: 'CHANTIER',
    chantierId: '',
    description: '',
    dateDebut,
    dateFin: dateDebut,
    touteLaJournee: true,
    heureDebut: '08:00',
    heureFin: '09:00',
    userIds,
    aPlanifier: false,
    candidates: [],
});

export const formValuesFromItem = (item: CalendarItem): AgendaFormValues => ({
    entryType: item.source === 'chantier' ? 'CHANTIER' : (item.type as EntryType),
    chantierId: item.chantier_id ? item.chantier_id.toString() : '',
    description: item.description || '',
    dateDebut: item.date_debut,
    dateFin: item.date_fin,
    touteLaJournee: item.toute_la_journee,
    heureDebut: item.heure_debut || '08:00',
    heureFin: item.heure_fin || '09:00',
    userIds: [item.user_id],
    // Editing an existing row never re-enters "à planifier" mode — that's a
    // create-time-only concept (see the Type selector's typeOptions logic
    // below for why category/mode can't change on an existing row).
    aPlanifier: false,
    candidates: [],
});

const TYPE_OPTIONS = [
    { value: 'CHANTIER', label: 'Chantier' },
    ...LEAVE_TYPE_OPTIONS,
];

// --- Multi-select employés : recherche + checklist + "tous les filtrés" ---

const MultiUserSelect: React.FC<{
    users: User[];
    selected: number[];
    onChange: (ids: number[]) => void;
    presetIds: number[]; // every employee — bulk-select button
}> = ({ users, selected, onChange, presetIds }) => {
    const [query, setQuery] = useState('');
    const filtered = useMemo(
        () => users.filter(u => u.username.toLowerCase().includes(query.toLowerCase())),
        [users, query]
    );
    const toggle = (id: number) => {
        onChange(selected.includes(id) ? selected.filter(x => x !== id) : [...selected, id]);
    };

    return (
        <div className="border border-slate-300 rounded-xl overflow-hidden">
            <div className="flex items-center gap-2 p-2 border-b border-slate-200 bg-slate-50">
                <Search size={14} className="text-slate-400 shrink-0" />
                <input
                    type="text"
                    value={query}
                    onChange={e => setQuery(e.target.value)}
                    placeholder="Rechercher un employé..."
                    className="flex-1 min-w-0 bg-transparent outline-none text-sm text-slate-900 placeholder-slate-400"
                />
                <button
                    type="button"
                    onClick={() => onChange(Array.from(new Set([...selected, ...presetIds])))}
                    className="shrink-0 flex items-center gap-1 text-[11px] font-bold text-primary hover:text-primary-dark transition-colors whitespace-nowrap"
                    title="Ajoute tous les employés"
                >
                    <CheckSquare size={13} /> Tous
                </button>
            </div>
            <div className="max-h-40 overflow-y-auto p-1">
                {filtered.map(u => (
                    <label key={u.id} className="flex items-center gap-2 px-2 py-1.5 rounded-lg hover:bg-slate-50 cursor-pointer text-sm">
                        <input
                            type="checkbox"
                            checked={selected.includes(u.id)}
                            onChange={() => toggle(u.id)}
                            className="rounded border-slate-300 text-primary focus:ring-primary/50"
                        />
                        <span className="truncate text-slate-700 font-medium">{u.username}</span>
                    </label>
                ))}
                {filtered.length === 0 && <p className="text-xs text-slate-400 italic px-2 py-1">Aucun employé.</p>}
            </div>
            {selected.length > 0 && (
                <div className="px-2 py-1.5 border-t border-slate-200 bg-slate-50 text-[11px] text-slate-500">
                    {selected.length} employé{selected.length > 1 ? 's' : ''} sélectionné{selected.length > 1 ? 's' : ''}
                </div>
            )}
        </div>
    );
};

// --- "Chantier à planifier": editable list of candidate date ranges ------
// Each row has its OWN "toute la journée" toggle (and heures when off) —
// deliberately independent per candidate, not one setting shared across
// all of them (one candidate can be a full day, another a 2h slot).

const CandidateListEditor: React.FC<{
    candidates: CandidateRange[];
    onChange: (candidates: CandidateRange[]) => void;
}> = ({ candidates, onChange }) => {
    const update = (idx: number, patch: Partial<CandidateRange>) => {
        onChange(candidates.map((c, i) => (i === idx ? { ...c, ...patch } : c)));
    };
    const remove = (idx: number) => onChange(candidates.filter((_, i) => i !== idx));
    const add = () => {
        const last = candidates[candidates.length - 1];
        onChange([...candidates, emptyCandidate(last?.dateDebut || new Date().toISOString().slice(0, 10))]);
    };

    return (
        <div>
            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Dates possibles</label>
            <div className="space-y-3">
                {candidates.map((c, idx) => (
                    <div key={idx} className="border border-slate-300 rounded-xl p-3 space-y-3 relative bg-slate-50/50">
                        <div className="flex items-center justify-between">
                            <span className="text-xs font-bold text-primary uppercase tracking-wide">Date possible {idx + 1}</span>
                            {candidates.length > 1 && (
                                <button type="button" onClick={() => remove(idx)} className="text-slate-400 hover:text-red-500 transition-colors" title="Retirer cette date">
                                    <X size={16} />
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 gap-3">
                            <div>
                                <label className="text-[11px] font-bold text-slate-400 uppercase mb-1 block">Début</label>
                                <AwesomeDatePicker value={c.dateDebut} onChange={d => update(idx, { dateDebut: d, dateFin: c.dateFin < d ? d : c.dateFin })} />
                            </div>
                            <div>
                                <label className="text-[11px] font-bold text-slate-400 uppercase mb-1 block">Fin</label>
                                <AwesomeDatePicker value={c.dateFin} onChange={d => update(idx, { dateFin: d })} minDate={c.dateDebut} />
                            </div>
                        </div>

                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={c.touteLaJournee}
                                onChange={e => update(idx, { touteLaJournee: e.target.checked })}
                                className="rounded border-slate-300 text-primary focus:ring-primary/50"
                            />
                            <span className="text-xs font-bold text-slate-700">Toute la journée</span>
                        </label>

                        {!c.touteLaJournee && (
                            <div className="grid grid-cols-2 gap-3">
                                <div>
                                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-1 block">Heure début</label>
                                    <input type="time" value={c.heureDebut} onChange={e => update(idx, { heureDebut: e.target.value })} className="input-field w-full" />
                                </div>
                                <div>
                                    <label className="text-[11px] font-bold text-slate-400 uppercase mb-1 block">Heure fin</label>
                                    <input type="time" value={c.heureFin} onChange={e => update(idx, { heureFin: e.target.value })} className="input-field w-full" />
                                </div>
                            </div>
                        )}
                    </div>
                ))}
            </div>
            <button
                type="button"
                onClick={add}
                className="mt-3 w-full py-2.5 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:text-primary hover:border-primary transition-all flex items-center justify-center gap-2 text-sm font-bold"
            >
                <Plus size={16} /> Ajouter une date possible
            </button>
        </div>
    );
};

// --- Form modal: create, or edit an existing item ------------------------

interface AgendaFormModalProps {
    mode: 'create' | 'edit';
    initial: AgendaFormValues;
    editingItem?: CalendarItem | null; // required when mode='edit'
    users: User[];
    sidebarUserIds: number[];
    // Ouvert depuis "Pot à chantier" (bouton Planifier) : le chantier est déjà
    // connu, le Type et la recherche Chantier sont verrouillés dessus — pas
    // de nouveau composant, juste ce champ en plus sur celui-ci.
    lockedChantier?: Chantier;
    onClose: () => void;
    onSaved: () => void;
}

export const AgendaFormModal: React.FC<AgendaFormModalProps> = ({ mode, initial, editingItem, users, sidebarUserIds, lockedChantier, onClose, onSaved }) => {
    const [values, setValues] = useState<AgendaFormValues>(initial);
    const [chantiers, setChantiers] = useState<Chantier[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [saving, setSaving] = useState(false);

    useEffect(() => {
        api.get('/api/chantiers').then(res => res.ok && res.json()).then((data: Chantier[] | false) => data && setChantiers(data));
    }, []);

    const editedUser = mode === 'edit' && editingItem ? users.find(u => u.id === editingItem.user_id) : null;
    const isPlanifierMode = mode === 'create' && values.entryType === 'CHANTIER' && values.aPlanifier;

    const validate = (): string | null => {
        if (mode === 'create' && values.userIds.length === 0) return 'Sélectionnez au moins un employé.';
        if (values.entryType === 'CHANTIER' && !values.chantierId) return 'Sélectionnez un chantier.';
        if (isPlanifierMode) {
            if (values.candidates.length === 0) return 'Ajoutez au moins une date possible.';
            for (const c of values.candidates) {
                if (c.dateFin < c.dateDebut) return 'Une date possible a sa date de fin avant sa date de début.';
                if (!c.touteLaJournee && c.heureFin <= c.heureDebut) return "Une date possible a une heure de fin avant son heure de début.";
            }
            return null;
        }
        if (values.dateFin < values.dateDebut) return 'La date de fin doit être après la date de début.';
        if (!values.touteLaJournee && values.heureFin <= values.heureDebut) return "L'heure de fin doit être après l'heure de début.";
        return null;
    };

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        const validationError = validate();
        if (validationError) { setError(validationError); return; }
        setError(null);
        setSaving(true);

        const period = {
            date_debut: values.dateDebut,
            date_fin: values.dateFin,
            toute_la_journee: values.touteLaJournee,
            heure_debut: values.touteLaJournee ? undefined : values.heureDebut,
            heure_fin: values.touteLaJournee ? undefined : values.heureFin,
        };

        let res;
        if (isPlanifierMode) {
            res = await api.post('/api/calendar/chantier-assignments', {
                chantier_id: parseInt(values.chantierId, 10),
                user_ids: values.userIds,
                description: values.description || undefined,
                a_planifier: true,
                candidates: values.candidates.map(c => ({
                    date_debut: c.dateDebut,
                    date_fin: c.dateFin,
                    toute_la_journee: c.touteLaJournee,
                    heure_debut: c.touteLaJournee ? undefined : c.heureDebut,
                    heure_fin: c.touteLaJournee ? undefined : c.heureFin,
                })),
            });
        } else if (mode === 'create') {
            res = values.entryType === 'CHANTIER'
                ? await api.post('/api/calendar/chantier-assignments', {
                    chantier_id: parseInt(values.chantierId, 10),
                    user_ids: values.userIds,
                    description: values.description || undefined,
                    ...period,
                })
                : await api.post('/api/calendar/leaves', {
                    type: values.entryType,
                    user_ids: values.userIds,
                    description: values.description || undefined,
                    ...period,
                });
        } else if (editingItem) {
            res = editingItem.source === 'chantier'
                ? await api.put(`/api/calendar/chantier-assignments/${editingItem.id}`, {
                    chantier_id: parseInt(values.chantierId, 10),
                    description: values.description || undefined,
                    ...period,
                })
                // Classic leave route — field names differ (date_start/date_end,
                // not date_debut/date_fin). No user_id here: reassigning the
                // owner of a leave isn't supported by this endpoint (see app.py).
                : await api.put(`/api/leaves/${editingItem.id}`, {
                    type: values.entryType,
                    date_start: values.dateDebut,
                    date_end: values.dateFin,
                    toute_la_journee: values.touteLaJournee,
                    heure_debut: period.heure_debut,
                    heure_fin: period.heure_fin,
                    description: values.description || undefined,
                });
        }

        setSaving(false);
        if (res && res.ok) {
            onSaved();
            onClose();
        } else {
            const body = res ? await res.json().catch(() => ({})) : {};
            setError(body.error || "Échec de l'enregistrement.");
        }
    };

    const isAbsenceType = values.entryType !== 'CHANTIER';
    // Switching category (chantier <-> absence) on an existing row isn't
    // supported — the two live on different endpoints/tables, a PUT can't
    // move a row between them. Locked to chantier when editing a chantier
    // assignment; restricted to the 6 absence sub-types when editing a leave.
    const typeOptions = lockedChantier ? null : (mode === 'create' ? TYPE_OPTIONS : (editingItem?.source === 'chantier' ? null : LEAVE_TYPE_OPTIONS));

    return (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 safe-top safe-bottom">
            <div className="card w-full max-w-xl max-h-[90vh] overflow-y-auto overflow-x-hidden">
                <div className="flex justify-between items-center mb-6">
                    <h3 className="text-xl font-bold text-slate-900 uppercase">{mode === 'create' ? 'Nouvelle entrée' : "Modifier l'entrée"}</h3>
                    <button type="button" onClick={onClose}><X className="text-slate-500" /></button>
                </div>

                <form onSubmit={handleSubmit} className="space-y-5">
                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Type</label>
                        {typeOptions ? (
                            <AwesomeSelect
                                value={values.entryType}
                                onChange={v => setValues({ ...values, entryType: v as EntryType })}
                                options={typeOptions}
                            />
                        ) : (
                            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 font-medium">Chantier</div>
                        )}
                    </div>

                    {values.entryType === 'CHANTIER' && (
                        <div>
                            <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Chantier</label>
                            {lockedChantier ? (
                                <div className="input-field bg-slate-50 text-slate-600 font-medium cursor-not-allowed flex items-center gap-2">
                                    <FolderOpen size={16} className="shrink-0 text-slate-400" /> {lockedChantier.nom}
                                </div>
                            ) : (
                                <InlineSearchSelect
                                    value={values.chantierId || undefined}
                                    onChange={v => setValues({ ...values, chantierId: v })}
                                    placeholder="Rechercher un chantier..."
                                    options={chantiers.map(c => ({ value: c.id.toString(), label: c.nom }))}
                                />
                            )}
                        </div>
                    )}

                    {values.entryType === 'CHANTIER' && mode === 'create' && (
                        <label className="flex items-center gap-2 cursor-pointer select-none">
                            <input
                                type="checkbox"
                                checked={values.aPlanifier}
                                onChange={e => setValues({
                                    ...values,
                                    aPlanifier: e.target.checked,
                                    // Seed one candidate from the single-range fields already
                                    // filled in, so switching the toggle doesn't lose them.
                                    candidates: e.target.checked && values.candidates.length === 0
                                        ? [{ dateDebut: values.dateDebut, dateFin: values.dateFin, touteLaJournee: values.touteLaJournee, heureDebut: values.heureDebut, heureFin: values.heureFin }]
                                        : values.candidates,
                                })}
                                className="rounded border-slate-300 text-primary focus:ring-primary/50"
                            />
                            <span className="text-sm font-bold text-slate-700 flex items-center gap-1.5">
                                <CalendarCheck size={14} className="text-primary" /> Chantier à planifier (dates multiples)
                            </span>
                        </label>
                    )}

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Description</label>
                        <textarea
                            value={values.description}
                            onChange={e => setValues({ ...values, description: e.target.value })}
                            rows={2}
                            className="input-field w-full resize-none"
                            placeholder="Remarque (optionnel)"
                        />
                    </div>

                    {isPlanifierMode ? (
                        <CandidateListEditor
                            candidates={values.candidates}
                            onChange={candidates => setValues({ ...values, candidates })}
                        />
                    ) : (
                        <>
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Date début</label>
                                    <AwesomeDatePicker value={values.dateDebut} onChange={d => setValues({ ...values, dateDebut: d, dateFin: values.dateFin < d ? d : values.dateFin })} />
                                </div>
                                <div>
                                    <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Date fin</label>
                                    <AwesomeDatePicker value={values.dateFin} onChange={d => setValues({ ...values, dateFin: d })} minDate={values.dateDebut} />
                                </div>
                            </div>

                            <label className="flex items-center gap-2 cursor-pointer select-none">
                                <input
                                    type="checkbox"
                                    checked={values.touteLaJournee}
                                    onChange={e => setValues({ ...values, touteLaJournee: e.target.checked })}
                                    className="rounded border-slate-300 text-primary focus:ring-primary/50"
                                />
                                <span className="text-sm font-bold text-slate-700">Toute la journée</span>
                            </label>

                            {!values.touteLaJournee && (
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Heure début</label>
                                        <input type="time" value={values.heureDebut} onChange={e => setValues({ ...values, heureDebut: e.target.value })} className="input-field w-full" />
                                    </div>
                                    <div>
                                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Heure fin</label>
                                        <input type="time" value={values.heureFin} onChange={e => setValues({ ...values, heureFin: e.target.value })} className="input-field w-full" />
                                    </div>
                                </div>
                            )}
                        </>
                    )}

                    <div>
                        <label className="text-xs font-bold text-slate-400 uppercase mb-2 block">Employé(s) concerné(s)</label>
                        {mode === 'create' ? (
                            <MultiUserSelect users={users} selected={values.userIds} onChange={ids => setValues({ ...values, userIds: ids })} presetIds={sidebarUserIds} />
                        ) : (
                            // Neither PUT endpoint supports reassigning the owner of an
                            // already-created row (chantier-assignments takes a single
                            // user_id it never got here; the leaves route doesn't accept
                            // one at all) — shown read-only rather than a picker that
                            // would silently do nothing.
                            <div className="px-3 py-2 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-600 font-medium">
                                {editedUser?.username || `Employé #${editingItem?.user_id}`}
                            </div>
                        )}
                    </div>

                    {isAbsenceType && mode === 'create' && (
                        <p className="text-xs text-slate-400 italic">
                            Une absence non-admin reste en attente de validation ; un admin qui la crée l'approuve automatiquement.
                        </p>
                    )}

                    {error && <p className="text-sm text-red-500 font-medium">{error}</p>}

                    <div className="flex justify-end gap-2 pt-2">
                        <button type="button" onClick={onClose} className="px-6 py-2 rounded-lg font-bold text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-colors">Annuler</button>
                        <button type="submit" disabled={saving} className="px-6 py-2 rounded-lg font-bold bg-primary text-white hover:bg-primary-dark transition-colors disabled:opacity-50">
                            {saving ? 'Enregistrement...' : 'Enregistrer'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    );
};

// --- Detail panel: view an existing block, jump to edit, or delete -------

interface AgendaDetailPanelProps {
    item: CalendarItem;
    users: User[];
    onClose: () => void;
    onEdit: () => void;
    onChanged: () => void;
    onOpenChantier: (chantier: Chantier) => void;
}

export const AgendaDetailPanel: React.FC<AgendaDetailPanelProps> = ({ item, users, onClose, onEdit, onChanged, onOpenChantier }) => {
    const [deleting, setDeleting] = useState(false);
    const [validating, setValidating] = useState(false);
    const [chantier, setChantier] = useState<Chantier | null>(null);
    const user = users.find(u => u.id === item.user_id);
    const isProposition = item.source === 'chantier' && item.statut === 'proposition';

    // Fetched for its own sake (address_work isn't on CalendarItem — the
    // calendar endpoint only sends what the grid needs to render a chip) and
    // reused as-is for "Voir le chantier", the same object shape App.tsx's
    // handleSelectChantier already expects — no second fetch there.
    useEffect(() => {
        if (item.source !== 'chantier' || !item.chantier_id) { setChantier(null); return; }
        api.get(`/api/chantiers/${item.chantier_id}`).then(res => res.ok && res.json()).then(data => data && setChantier(data));
    }, [item.source, item.chantier_id]);

    const handleDelete = async () => {
        if (!confirm('Supprimer cette entrée ?')) return;
        setDeleting(true);
        const res = item.source === 'chantier'
            ? await api.delete(`/api/calendar/chantier-assignments/${item.id}`)
            : await api.delete(`/api/leaves/${item.id}`);
        setDeleting(false);
        if (res.ok) {
            onChanged();
            onClose();
        } else {
            const body = await res.json().catch(() => ({}));
            alert(body.error || 'Suppression impossible.');
        }
    };

    // Client picked this candidate date: confirms it (statut -> 'confirme')
    // and drops every other proposition in the same group server-side —
    // see PUT .../valider in app.py.
    const handleValider = async () => {
        if (!confirm('Valider cette date ? Les autres dates possibles de ce chantier seront supprimées.')) return;
        setValidating(true);
        const res = await api.put(`/api/calendar/chantier-assignments/${item.id}/valider`);
        setValidating(false);
        if (res.ok) {
            onChanged();
            onClose();
        } else {
            const body = await res.json().catch(() => ({}));
            alert(body.error || 'Validation impossible.');
        }
    };

    return (
        <div className="fixed inset-0 bg-white/80 backdrop-blur-sm flex items-center justify-center z-[100] p-4 safe-top safe-bottom">
            <div className="card w-full max-w-md">
                <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                        <span className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: item.couleur }} />
                        <h3 className="text-lg font-bold text-slate-900">{item.titre}</h3>
                    </div>
                    <button onClick={onClose}><X className="text-slate-500" /></button>
                </div>

                {item.source === 'leave' && item.status && (
                    <div className="mb-4"><StatusBadge status={item.status} type="leave" /></div>
                )}
                {isProposition && (
                    <div className="mb-4">
                        <span className="px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider bg-amber-100 text-amber-700 border border-amber-300">
                            Proposition — en attente de confirmation client
                        </span>
                    </div>
                )}

                <div className="space-y-3 text-sm">
                    <div>
                        <span className="text-xs font-bold text-slate-400 uppercase">Employé</span>
                        <div className="text-slate-900 font-medium">{user?.username || `#${item.user_id}`}</div>
                    </div>
                    <div>
                        <span className="text-xs font-bold text-slate-400 uppercase">Dates</span>
                        <div className="text-slate-900 font-mono">
                            {item.date_debut}{item.date_fin !== item.date_debut ? ` → ${item.date_fin}` : ''}
                            {!item.toute_la_journee && item.heure_debut && ` · ${item.heure_debut}–${item.heure_fin}`}
                        </div>
                    </div>
                    {item.description && (
                        <div>
                            <span className="text-xs font-bold text-slate-400 uppercase">Description</span>
                            <div className="text-slate-600 whitespace-pre-wrap">{item.description}</div>
                        </div>
                    )}
                    {item.source === 'leave' && (
                        <div className="text-xs text-slate-400">Type : {LEAVE_TYPE_LABELS[item.type] || item.type}</div>
                    )}
                    {chantier?.address_work && (
                        <div>
                            <span className="text-xs font-bold text-slate-400 uppercase">Adresse travaux</span>
                            <a
                                href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(chantier.address_work)}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center gap-1.5 text-primary hover:text-primary-dark hover:underline transition-colors"
                            >
                                <MapPin size={14} className="shrink-0" />
                                {chantier.address_work}
                            </a>
                        </div>
                    )}
                </div>

                {item.source === 'chantier' && chantier && (
                    <button
                        onClick={() => { onOpenChantier(chantier); onClose(); }}
                        className="w-full mt-5 py-2.5 rounded-lg font-bold text-sm bg-slate-100 text-slate-700 hover:bg-slate-200 transition-all flex items-center justify-center gap-2"
                    >
                        <FolderOpen size={16} /> Voir le chantier
                    </button>
                )}

                <div className="flex justify-end gap-2 pt-6">
                    {isProposition && (
                        <button
                            onClick={handleValider}
                            disabled={validating}
                            className="mr-auto px-4 py-2 rounded-lg font-bold bg-primary text-white hover:bg-primary-dark transition-all disabled:opacity-50 flex items-center gap-2 text-sm"
                        >
                            <CalendarCheck size={16} /> {validating ? 'Validation...' : 'Valider cette date'}
                        </button>
                    )}
                    <button onClick={handleDelete} disabled={deleting} className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all disabled:opacity-50" title="Supprimer">
                        <Trash2 size={18} />
                    </button>
                    <button onClick={onEdit} className="p-2 rounded-lg bg-slate-100 text-slate-500 hover:text-slate-900 hover:bg-slate-200 transition-all" title="Modifier">
                        <Pencil size={18} />
                    </button>
                </div>
            </div>
        </div>
    );
};
