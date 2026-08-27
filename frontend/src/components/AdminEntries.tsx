import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Entry } from '../types';
import { Check, X, Pencil, CheckCheck, Loader2 } from 'lucide-react';
import { api } from '../api';

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

    // Edit state
    const [editingId, setEditingId] = useState<number | null>(null);
    const [editForm, setEditForm] = useState({
        heures: '',
        materiel: ''
    });

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
            materiel: parseFloat(editForm.materiel) || 0
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
            materiel: entry.materiel.toString()
        });
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
                <div className="bg-slate-50 px-4 py-2 rounded-lg text-slate-900 font-mono font-bold">
                    {entries.length} En attente
                </div>
            </div>

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
                                    <div className="flex items-center gap-2" onClick={ev => ev.stopPropagation()}>
                                        <input
                                            type="number" step="0.5" inputMode="decimal"
                                            className="w-20 bg-white border border-black/10 rounded px-2 py-1.5 text-right font-mono font-bold focus:outline-none focus:border-ohm-primary"
                                            value={editForm.heures}
                                            onChange={ev => setEditForm({ ...editForm, heures: ev.target.value })}
                                            autoFocus
                                        />
                                        <input
                                            type="number" step="0.01" inputMode="decimal"
                                            className="w-20 bg-white border border-black/10 rounded px-2 py-1.5 text-right font-mono font-bold text-blue-500 focus:outline-none focus:border-blue-500"
                                            value={editForm.materiel}
                                            onChange={ev => setEditForm({ ...editForm, materiel: ev.target.value })}
                                        />
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
                                        <div className="text-right font-mono font-bold text-blue-500 w-16 shrink-0">
                                            {e.materiel > 0 ? `${e.materiel} .-` : '-'}
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
