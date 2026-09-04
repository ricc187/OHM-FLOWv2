import React, { useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, GripVertical } from 'lucide-react';
import { ChantierPrevision } from '../types';
import { api } from '../api';

// Calendrier annuel de la prévision — barre horizontale par chantier,
// redimensionnable par ses deux extrémités (date_debut_theorique à gauche,
// date_fin_theorique à droite).
//
// Le drag&drop de l'Agenda (useEntryDrag.ts) résout un problème différent :
// déplacer un bloc ENTIER vers une CELLULE-JOUR discrète (lookup DOM via
// data-drop-date + elementFromPoint). Ici il n'y a ni cellule ni déplacement :
// juste deux poignées aux bords d'une barre continue sur une échelle
// temporelle annuelle en jours — la position se calcule directement à partir
// de la coordonnée X du pointeur dans la piste (translation jour <-> %),
// donc un hook dédié, plus simple, plutôt que réutiliser useEntryDrag tel quel.
//
// Optimistic UI : pendant le drag, seul un état local `live` change (aucun
// appel réseau) — la barre suit le pointeur. Au relâchement, la valeur est
// appliquée à `items` (optimiste) puis persistée par PUT ; en cas d'échec,
// `items` est restauré à sa valeur d'avant le drag.

const MONTH_SHORT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISODate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

const yearStart = (y: number) => new Date(y, 0, 1);
const yearEnd = (y: number) => new Date(y, 11, 31);
const daysInYear = (y: number) => Math.round((yearEnd(y).getTime() - yearStart(y).getTime()) / 86400000) + 1;

// Largeur de chaque colonne mois proportionnelle à son nombre de jours réel
// (pas 12 colonnes égales) — indispensable pour que l'en-tête reste aligné
// avec les barres, positionnées elles aussi en fraction de jour dans l'année.
function monthColumns(year: number) {
    const total = daysInYear(year);
    let acc = 0;
    return Array.from({ length: 12 }, (_, m) => {
        const days = new Date(year, m + 1, 0).getDate();
        const widthPct = (days / total) * 100;
        acc += days;
        return { label: MONTH_SHORT[m], widthPct };
    });
}

// Un chantier "touche" l'année affichée si sa plage la recoupe — comparaison
// de chaînes ISO valide tant que les deux bornes restent au format YYYY-MM-DD.
const overlapsYear = (item: ChantierPrevision, year: number) =>
    !!item.date_debut_theorique && !!item.date_fin_theorique &&
    item.date_debut_theorique <= `${year}-12-31` && item.date_fin_theorique >= `${year}-01-01`;

// Position/largeur de la barre en % de la piste, bornées à l'année affichée
// (un chantier à cheval sur deux années n'affiche que la portion de cette
// année-ci — voir "Questions ouvertes" du rapport pour cette limitation connue).
function barGeometry(debut: string, fin: string, year: number) {
    const start = yearStart(year), end = yearEnd(year), total = daysInYear(year);
    const clampedDebut = parseISODate(debut) < start ? start : parseISODate(debut) > end ? end : parseISODate(debut);
    const clampedFin = parseISODate(fin) < start ? start : parseISODate(fin) > end ? end : parseISODate(fin);
    const leftDays = Math.round((clampedDebut.getTime() - start.getTime()) / 86400000);
    const spanDays = Math.max(1, Math.round((clampedFin.getTime() - clampedDebut.getTime()) / 86400000) + 1);
    return { leftPct: (leftDays / total) * 100, widthPct: (spanDays / total) * 100 };
}

const dateFromClientX = (clientX: number, trackRect: DOMRect, year: number): string => {
    const total = daysInYear(year);
    const frac = Math.min(1, Math.max(0, (clientX - trackRect.left) / trackRect.width));
    const dayIdx = Math.round(frac * (total - 1));
    return toISODate(addDays(yearStart(year), dayIdx));
};

const barClasses = (statut: string) =>
    statut === 'confirme'
        ? 'bg-emerald-500 text-white'
        : 'bg-amber-400 text-amber-950';

interface DragState {
    id: number;
    edge: 'start' | 'end';
    trackEl: HTMLElement;
}

interface LiveEdit {
    id: number;
    debut: string;
    fin: string;
}

interface Props {
    items: ChantierPrevision[];
    setItems: React.Dispatch<React.SetStateAction<ChantierPrevision[]>>;
    onError: (message: string) => void;
    // Lifted to PrevisionAnnuelle.tsx (not local state here) — the dashboard
    // needs to recompute off the exact same displayed year.
    year: number;
    setYear: React.Dispatch<React.SetStateAction<number>>;
}

export const PrevisionTimeline: React.FC<Props> = ({ items, setItems, onError, year, setYear }) => {
    const [live, setLive] = useState<LiveEdit | null>(null);

    // Mirrors `live` so the pointerup handler always reads the latest value
    // synchronously — it fires on the SAME captured element across many
    // re-renders (one per pointermove), so relying on the `live` closure
    // captured at pointerdown would read a stale value.
    const liveRef = useRef<LiveEdit | null>(null);
    const dragStateRef = useRef<DragState | null>(null);

    const setLiveBoth = (v: LiveEdit | null) => { liveRef.current = v; setLive(v); };

    const months = useMemo(() => monthColumns(year), [year]);

    const rowsThisYear = useMemo(() => items.filter(i => overlapsYear(i, year)), [items, year]);
    const withoutDates = useMemo(() => items.filter(i => !i.date_debut_theorique || !i.date_fin_theorique), [items]);

    const onHandlePointerDown = (item: ChantierPrevision, edge: 'start' | 'end') => (e: React.PointerEvent) => {
        e.stopPropagation();
        e.preventDefault();
        const handle = e.currentTarget as HTMLElement;
        const track = handle.closest<HTMLElement>('[data-timeline-track]');
        if (!track || !item.date_debut_theorique || !item.date_fin_theorique) return;
        try { handle.setPointerCapture(e.pointerId); } catch { /* ignore */ }
        dragStateRef.current = { id: item.id, edge, trackEl: track };
        setLiveBoth({ id: item.id, debut: item.date_debut_theorique, fin: item.date_fin_theorique });
    };

    const onHandlePointerMove = (e: React.PointerEvent) => {
        const st = dragStateRef.current;
        const prev = liveRef.current;
        if (!st || !prev || prev.id !== st.id) return;
        e.preventDefault();
        const rect = st.trackEl.getBoundingClientRect();
        const newDate = dateFromClientX(e.clientX, rect, year);
        if (st.edge === 'start') {
            setLiveBoth({ ...prev, debut: newDate > prev.fin ? prev.fin : newDate });
        } else {
            setLiveBoth({ ...prev, fin: newDate < prev.debut ? prev.debut : newDate });
        }
    };

    const endDrag = async () => {
        const st = dragStateRef.current;
        const finalLive = liveRef.current;
        dragStateRef.current = null;
        setLiveBoth(null);
        if (!st || !finalLive) return;

        const original = items.find(p => p.id === st.id);
        if (!original) return;

        const field = st.edge === 'start' ? 'date_debut_theorique' : 'date_fin_theorique';
        const newValue = st.edge === 'start' ? finalLive.debut : finalLive.fin;
        const previousValue = original[field];
        if (newValue === previousValue) return; // released without actually moving the edge

        // Optimistic commit — the bar already reflects `newValue` once `live`
        // clears, since it now falls back to reading straight from `items`.
        setItems(prev => prev.map(p => (p.id === st.id ? { ...p, [field]: newValue } : p)));

        const res = await api.put(`/api/prevision/${st.id}`, { [field]: newValue });
        if (!res.ok) {
            setItems(prev => prev.map(p => (p.id === st.id ? { ...p, [field]: previousValue } : p)));
            const data = await res.json().catch(() => ({}));
            onError(data.error || 'Impossible de redimensionner ce chantier.');
        }
    };

    const onHandlePointerUp = (e: React.PointerEvent) => { e.preventDefault(); endDrag(); };
    const onHandlePointerCancel = () => { dragStateRef.current = null; setLiveBoth(null); };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">Calendrier annuel</h3>
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1">
                        <button onClick={() => setYear(y => y - 1)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white active:scale-95 transition-all" aria-label="Année précédente">
                            <ChevronLeft size={16} />
                        </button>
                        <span className="px-2 text-sm font-bold text-slate-900 min-w-[3.5rem] text-center">{year}</span>
                        <button onClick={() => setYear(y => y + 1)} className="min-w-[36px] min-h-[36px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white active:scale-95 transition-all" aria-label="Année suivante">
                            <ChevronRight size={16} />
                        </button>
                    </div>
                    <button onClick={() => setYear(new Date().getFullYear())} className="min-h-[36px] px-3 py-2 rounded-lg text-xs font-bold text-ohm-primary hover:bg-ohm-primary/10 active:scale-95 transition-all uppercase tracking-wider">
                        Année en cours
                    </button>
                    <div className="flex items-center gap-3 text-[10px] font-bold uppercase tracking-wider text-slate-400 pl-2">
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-amber-400 inline-block" /> Prévu</span>
                        <span className="flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-sm bg-emerald-500 inline-block" /> Confirmé</span>
                    </div>
                </div>
            </div>

            <div className="bg-ohm-surface border border-slate-200 rounded-2xl shadow-xl overflow-hidden">
                <div className="overflow-x-auto">
                    <div className="min-w-[900px]">
                        {/* Header: label spacer + proportional month columns. The month
                            row lives in its OWN flex-1 wrapper (not directly in the outer
                            flex row) so each width:X% resolves against the same "remaining
                            space after the label column" box as every row's flex-1 track
                            below — putting the percentages straight in the outer row would
                            compute them against the full row width (label included) and
                            overflow past it by exactly the label's width. */}
                        <div className="flex bg-slate-50 border-b border-slate-200">
                            <div className="w-56 shrink-0" />
                            <div className="flex flex-1">
                                {months.map((m, i) => (
                                    <div
                                        key={i}
                                        style={{ width: `${m.widthPct}%` }}
                                        className="p-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest border-l border-slate-200 first:border-l-0"
                                    >
                                        {m.label}
                                    </div>
                                ))}
                            </div>
                        </div>

                        {rowsThisYear.length === 0 && (
                            <div className="px-6 py-10 text-center text-slate-400 italic text-sm">
                                Aucun chantier avec des dates théoriques sur {year}.
                            </div>
                        )}

                        {rowsThisYear.map(item => {
                            const displayDebut = live && live.id === item.id ? live.debut : item.date_debut_theorique!;
                            const displayFin = live && live.id === item.id ? live.fin : item.date_fin_theorique!;
                            const { leftPct, widthPct } = barGeometry(displayDebut, displayFin, year);
                            return (
                                <div key={item.id} className="flex items-center border-b border-slate-100 last:border-b-0 h-14">
                                    <div className="w-56 shrink-0 px-3 min-w-0">
                                        <div className="text-xs font-bold text-slate-900 truncate" title={item.nom}>{item.nom}</div>
                                        <div className="text-[10px] text-slate-400 truncate">
                                            {item.statut === 'confirme' ? 'Confirmé' : 'Prévu'}{item.referent_username ? ` · ${item.referent_username}` : ''}
                                        </div>
                                    </div>
                                    <div className="relative flex-1 h-full" data-timeline-track>
                                        <div
                                            className={`absolute top-1/2 -translate-y-1/2 h-8 rounded-lg shadow-sm flex items-center select-none ${barClasses(item.statut)}`}
                                            style={{ left: `${leftPct}%`, width: `${widthPct}%`, minWidth: '1.5rem' }}
                                            title={`${displayDebut} → ${displayFin}`}
                                        >
                                            <div
                                                onPointerDown={onHandlePointerDown(item, 'start')}
                                                onPointerMove={onHandlePointerMove}
                                                onPointerUp={onHandlePointerUp}
                                                onPointerCancel={onHandlePointerCancel}
                                                style={{ touchAction: 'none' }}
                                                className="absolute left-0 top-0 bottom-0 w-3 flex items-center justify-start cursor-ew-resize opacity-0 hover:opacity-70 transition-opacity"
                                            >
                                                <GripVertical size={12} />
                                            </div>
                                            <span className="px-3 text-[11px] font-bold truncate flex-1 pointer-events-none">{item.nom}</span>
                                            <div
                                                onPointerDown={onHandlePointerDown(item, 'end')}
                                                onPointerMove={onHandlePointerMove}
                                                onPointerUp={onHandlePointerUp}
                                                onPointerCancel={onHandlePointerCancel}
                                                style={{ touchAction: 'none' }}
                                                className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-end cursor-ew-resize opacity-0 hover:opacity-70 transition-opacity"
                                            >
                                                <GripVertical size={12} />
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>

            {withoutDates.length > 0 && (
                <div className="card p-4 text-xs text-slate-500">
                    <span className="font-bold text-slate-600">Sans dates théoriques (pas affichés dans le calendrier) : </span>
                    {withoutDates.map(i => i.nom).join(', ')}
                </div>
            )}
        </div>
    );
};
