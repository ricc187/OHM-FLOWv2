import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Entry, User, Chantier } from '../types';
import { Check, X, Pencil, CheckCheck, Loader2, Plus, UserCog } from 'lucide-react';
import { api } from '../api';
import { AwesomeSelect } from './ui/AwesomeSelect';

interface Props {
    currentUser: any;
}

const todayStr = new Date().toISOString().split('T')[0];
const yesterdayD = new Date();
yesterdayD.setDate(yesterdayD.getDate() - 1);
const yesterdayStr = yesterdayD.toISOString().split('T')[0];

const formatDateHeader = (dateStr: string) => {
    const d = new Date(dateStr + 'T00:00:00');
    const label = d.toLocaleDateString('fr-CH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
    const capped = label.charAt(0).toUpperCase() + label.slice(1);
    if (dateStr === todayStr) return `Aujourd'hui — ${capped}`;
    if (dateStr === yesterdayStr) return `Hier — ${capped}`;
    return capped;
};

export const AdminEntries: React.FC<Props> = () => {
    const [entries, setEntries] = useState<Entry[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [chantiers, setChantiers] = useState<Chantier[]>([]);

    // Edit state
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        heures: '',
        user_id: ''
    });

    // "Nouvelle saisie au nom de quelqu'un" — admin can log hours for another
    // worker (e.g. they forgot, or are on-site without the app).
    const [showNewForm, setShowNewForm] = useState(false);
    const [newForm, setNewForm] = useState({
        user_id: '', chantier_id: '', date: todayStr, heures: ''
    });
    const [creatingEntry, setCreatingEntry] = useState(false);

    // Keyboard-first review: one entry "focused" at a time — Enter validates
    // it and moves to whatever now occupies that slot (i.e. the next one).
    // Defaults to yesterday's entries since that's what admins review the
    // morning after, not today's (still-incoming) ones.
    const [focusedIndex, setFocusedIndex] = useState(0);
    const isFirstLoad = useRef(true);
    const rowRefs = useRef<(HTMLDivElement | null)[]>([]);

    const sorted = useMemo(() => [...entries].sort((a, b) => b.date.localeCompare(a.date)), [entries]);

    useEffect(() => {
        fetchPendingEntries();
        api.get('/api/users').then(res => res.ok && res.json()).then(data => data && setUsers(data));
        api.get('/api/chantiers?status=ALL').then(res => res.ok && res.json()).then(data => data && setChantiers(data));
    }, []);

    const fetchPendingEntries = async () => {
        const res = await api.get('/api/entries/pending');
        if (!res.ok) return;
        const data: Entry[] = await res.json();
        const newSorted = [...data].sort((a, b) => b.date.localeCompare(a.date));
        if (isFirstLoad.current) {
            isFirstLoad.current = false;
            const yIdx = newSorted.findIndex(e => e.date === yesterdayStr);
            setFocusedIndex(yIdx >= 0 ? yIdx : 0);
        } else {
            setFocusedIndex(i => Math.min(i, Math.max(newSorted.length - 1, 0)));
        }
        setEntries(data);
    };

    const handleValidate = async (entryId: number) => {
        const res = await api.put(`/api/entries/${entryId}/validate`);
        if (res.ok) {
            setEditingId(null);
            fetchPendingEntries();
        }
    };

    const handleSaveEdit = async (entryId: number) => {
        const res = await api.put(`/api/entries/${entryId}`, {
            heures: parseFloat(editForm.heures) || 0,
            user_id: parseInt(editForm.user_id, 10)
        });

        if (res.ok) {
            setEditingId(null);
            fetchPendingEntries();
        } else {
            alert('Erreur lors de la modification');
        }
    };

    const startEditing = (entry: Entry) => {
        setEditingId(entry.id);
        setEditForm({
            heures: entry.heures.toString(),
            user_id: entry.user_id.toString()
        });
    };

    const handleCreateForOther = async () => {
        if (!newForm.user_id || !newForm.chantier_id || !newForm.date) {
            alert('Utilisateur, chantier et date sont requis');
            return;
        }
        setCreatingEntry(true);
        try {
            const res = await api.post('/api/entries', {
                user_id: parseInt(newForm.user_id, 10),
                chantier_id: parseInt(newForm.chantier_id, 10),
                date: newForm.date,
                heures: parseFloat(newForm.heures) || 0,
                materiel: 0
            });
            if (res.ok) {
                setShowNewForm(false);
                setNewForm({ user_id: '', chantier_id: '', date: todayStr, heures: '' });
                fetchPendingEntries();
            } else {
                alert('Erreur lors de la création');
            }
        } finally {
            setCreatingEntry(false);
        }
    };

    const handleReject = async (entryId: number) => {
        if (confirm('Refuser et supprimer cette saisie ?')) {
            const res = await api.delete(`/api/entries/${entryId}`);
            if (res.ok) {
                fetchPendingEntries();
            }
        }
    };

    const [validatingDay, setValidatingDay] = useState<string | null>(null);
    const handleValidateDay = async (date: string) => {
        const ids = sorted.filter(e => e.date === date).map(e => e.id);
        if (ids.length === 0) return;
        if (!confirm(`Valider les ${ids.length} saisie(s) de ce jour ?`)) return;
        setValidatingDay(date);
        try {
            // Settle, not all — one dropped connection shouldn't abort the
            // whole batch and leave the button stuck disabled forever.
            await Promise.allSettled(ids.map(id => api.put(`/api/entries/${id}/validate`)));
        } finally {
            setValidatingDay(null);
            fetchPendingEntries();
        }
    };

    // Enter validates the focused entry (and auto-advances); arrows move the
    // focus without acting. Disabled while editing, or while typing anywhere
    // else on the page, so it never hijacks normal form input.
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent) => {
            if (editingId !== null) return;
            const tag = (document.activeElement?.tagName || '').toLowerCase();
            if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
            if (sorted.length === 0) return;

            if (e.key === 'Enter') {
                e.preventDefault();
                const entry = sorted[focusedIndex];
                if (entry) handleValidate(entry.id);
            } else if (e.key === 'ArrowDown') {
                e.preventDefault();
                setFocusedIndex(i => Math.min(i + 1, sorted.length - 1));
            } else if (e.key === 'ArrowUp') {
                e.preventDefault();
                setFocusedIndex(i => Math.max(i - 1, 0));
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [sorted, focusedIndex, editingId]);

    useEffect(() => {
        rowRefs.current[focusedIndex]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }, [focusedIndex]);

    let lastDate: string | null = null;

    return (
        <div className="space-y-6 animate-fade-in pb-12">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Check className="text-ohm-primary" size={32} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Validation Saisies</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Entrée = valider la saisie surlignée · ↑↓ pour naviguer</p>
                </div>
                <div className="flex items-center gap-3">
                    <button
                        onClick={() => setShowNewForm(v => !v)}
                        className="flex items-center gap-2 px-4 py-2 rounded-lg bg-slate-900 text-white hover:bg-slate-700 transition-all font-bold text-sm"
                    >
                        <Plus size={16} /> Saisie pour un tiers
                    </button>
                    <div className="bg-slate-50 px-4 py-2 rounded-lg text-slate-900 font-mono font-bold">
                        {entries.length} En attente
                    </div>
                </div>
            </div>

            {showNewForm && (
                <div className="card p-4 space-y-3 border border-slate-200 bg-slate-50/60 animate-fade-in">
                    <div className="text-sm font-bold text-slate-700 flex items-center gap-2">
                        <UserCog size={16} /> Enregistrer une saisie au nom d'un autre utilisateur
                    </div>
                    <div className="grid grid-cols-1 sm:grid-cols-4 gap-3">
                        <AwesomeSelect
                            placeholder="Utilisateur"
                            value={newForm.user_id}
                            onChange={val => setNewForm({ ...newForm, user_id: val })}
                            options={users.map(u => ({ value: u.id.toString(), label: u.username }))}
                        />
                        <AwesomeSelect
                            placeholder="Chantier"
                            value={newForm.chantier_id}
                            onChange={val => setNewForm({ ...newForm, chantier_id: val })}
                            options={chantiers.map(c => ({ value: c.id.toString(), label: c.nom }))}
                        />
                        <input
                            type="date"
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-ohm-primary"
                            value={newForm.date}
                            onChange={e => setNewForm({ ...newForm, date: e.target.value })}
                        />
                        <input
                            type="number" step="0.5" inputMode="decimal"
                            placeholder="Heures"
                            className="w-full bg-white border border-slate-300 rounded-xl px-4 py-3 text-slate-900 focus:outline-none focus:border-ohm-primary"
                            value={newForm.heures}
                            onChange={e => setNewForm({ ...newForm, heures: e.target.value })}
                        />
                    </div>
                    <div className="flex justify-end gap-2">
                        <button onClick={() => setShowNewForm(false)} className="px-4 py-2 rounded-lg bg-slate-100 text-slate-600 hover:bg-slate-200 transition-all text-sm font-bold">
                            Annuler
                        </button>
                        <button
                            onClick={handleCreateForOther}
                            disabled={creatingEntry}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all text-sm font-bold disabled:opacity-50"
                        >
                            {creatingEntry ? <Loader2 size={16} className="animate-spin" /> : <Plus size={16} />}
                            Créer la saisie
                        </button>
                    </div>
                </div>
            )}

            <div className="space-y-6">
                {sorted.map((e, idx) => {
                    const showHeader = e.date !== lastDate;
                    lastDate = e.date;
                    const isFocused = idx === focusedIndex;
                    const isEditing = editingId === e.id;

                    return (
                        <React.Fragment key={e.id}>
                            {showHeader && (
                                <div className="text-sm font-bold text-slate-500 uppercase tracking-wider pt-2 first:pt-0 flex items-center justify-between gap-2 flex-wrap">
                                    <div className="flex items-center gap-2">
                                        {e.date === yesterdayStr && <span className="w-2 h-2 rounded-full bg-ohm-primary" />}
                                        {formatDateHeader(e.date)}
                                    </div>
                                    <button
                                        onClick={() => handleValidateDay(e.date)}
                                        disabled={validatingDay !== null}
                                        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-100 text-slate-600 hover:bg-ohm-primary hover:text-ohm-bg transition-all text-xs font-bold normal-case disabled:opacity-50"
                                    >
                                        {validatingDay === e.date ? <Loader2 size={14} className="animate-spin" /> : <CheckCheck size={14} />}
                                        Valider tout ce jour
                                    </button>
                                </div>
                            )}
                            <div
                                ref={el => { rowRefs.current[idx] = el; }}
                                onClick={() => setFocusedIndex(idx)}
                                className={`group p-4 rounded-2xl border transition-all flex items-center gap-3 sm:gap-4 flex-wrap sm:flex-nowrap cursor-pointer ${isFocused ? 'border-ohm-primary ring-2 ring-ohm-primary/30 bg-ohm-primary/5' : 'border-slate-200 bg-white hover:border-slate-300'
                                    }`}
                            >
                                <div className="w-9 h-9 rounded-full bg-slate-100 flex items-center justify-center font-bold text-xs text-slate-900 shrink-0">
                                    {e.user_name?.[0]}
                                </div>
                                <div className="min-w-0 flex-1">
                                    <div className="font-bold text-slate-900 truncate">{e.user_name}</div>
                                    <div className="text-xs text-slate-500 truncate">{e.chantier_nom}</div>
                                </div>

                                {isEditing ? (
                                    <div className="flex items-center gap-2 flex-wrap" onClick={ev => ev.stopPropagation()}>
                                        <input
                                            type="number" step="0.5" inputMode="decimal"
                                            className="w-20 bg-white border border-black/10 rounded px-2 py-1.5 text-right font-mono font-bold focus:outline-none focus:border-ohm-primary"
                                            value={editForm.heures}
                                            onChange={ev => setEditForm({ ...editForm, heures: ev.target.value })}
                                            autoFocus
                                        />
                                        <div className="w-44">
                                            <AwesomeSelect
                                                placeholder="Utilisateur"
                                                value={editForm.user_id}
                                                onChange={val => setEditForm({ ...editForm, user_id: val })}
                                                options={users.map(u => ({ value: u.id.toString(), label: u.username }))}
                                            />
                                        </div>
                                        <button onClick={() => setEditingId(null)} className="p-2 rounded-lg bg-slate-100 hover:bg-slate-200 text-slate-900 transition-all" title="Annuler">
                                            <X size={18} />
                                        </button>
                                        <button onClick={() => handleSaveEdit(e.id)} className="p-2 rounded-lg bg-blue-500/20 text-blue-500 hover:bg-blue-500 hover:text-white transition-all" title="Enregistrer">
                                            <Check size={18} />
                                        </button>
                                    </div>
                                ) : (
                                    <>
                                        <div className="text-right font-mono font-bold text-slate-900 w-16 shrink-0">
                                            {e.heures > 0 ? `${e.heures} h` : '-'}
                                        </div>

                                        {/* Modifier/Refuser stay secondary — dim by default, need the mouse
                                            to reach them (full opacity only on hover on desktop; kept
                                            faintly visible on touch screens where hover doesn't exist) */}
                                        <div className="flex items-center gap-1 opacity-30 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                                            <button
                                                onClick={ev => { ev.stopPropagation(); startEditing(e); }}
                                                className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition-all"
                                                title="Modifier"
                                            >
                                                <Pencil size={16} />
                                            </button>
                                            <button
                                                onClick={ev => { ev.stopPropagation(); handleReject(e.id); }}
                                                className="p-2 rounded-lg bg-red-500/10 text-red-400 hover:bg-red-500 hover:text-white transition-all"
                                                title="Refuser"
                                            >
                                                <X size={16} />
                                            </button>
                                        </div>

                                        <button
                                            onClick={ev => { ev.stopPropagation(); handleValidate(e.id); }}
                                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-ohm-primary text-ohm-bg hover:bg-yellow-300 transition-all shadow-lg shadow-primary/20 font-bold text-sm shrink-0"
                                            title="Valider"
                                        >
                                            <Check size={18} strokeWidth={3} /> Valider
                                            {isFocused && <kbd className="ml-1 px-1.5 py-0.5 rounded bg-black/10 text-[10px] font-mono">↵</kbd>}
                                        </button>
                                    </>
                                )}
                            </div>
                        </React.Fragment>
                    );
                })}

                {entries.length === 0 && (
                    <div className="card p-12 text-center text-slate-400 italic flex flex-col items-center">
                        <Check size={48} className="opacity-20 mb-4" />
                        <p>Tout est à jour ! Aucune saisie en attente.</p>
                    </div>
                )}
            </div>
        </div>
    );
};
