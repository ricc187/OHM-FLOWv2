import React, { useEffect, useMemo, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Plus } from 'lucide-react';
import { CalendarItem, Chantier, User } from '../types';
import { api } from '../api';
import { useAutoRefresh } from '../hooks/useAutoRefresh';
import { useEscapeKey } from '../hooks/useEscapeKey';
import { useIsMobile } from '../hooks/useIsMobile';
import { useEntryDrag, DropTarget } from '../hooks/useEntryDrag';
import { setAppModalOpen } from '../modalState';
import { AgendaFormModal, AgendaDetailPanel, AgendaFormValues, emptyFormValues, formValuesFromItem } from './AgendaForm';

// --- Date helpers -----------------------------------------------------
// Same "parse YYYY-MM-DD as local components" discipline as Planning.tsx's
// CalendarView — never let `new Date("YYYY-MM-DD")` (UTC midnight) silently
// shift a day when the browser isn't in UTC.

const pad2 = (n: number) => String(n).padStart(2, '0');
const toISODate = (d: Date) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const parseISODate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };
const startOfDay = (d: Date) => { const r = new Date(d); r.setHours(0, 0, 0, 0); return r; };
const daysBetweenISO = (a: string, b: string) => Math.round((parseISODate(b).getTime() - parseISODate(a).getTime()) / 86400000);
// Monday-start week, matching CalendarView's convention elsewhere in the app.
const getMonday = (d: Date) => { const day = d.getDay(); const diff = day === 0 ? -6 : 1 - day; return addDays(startOfDay(d), diff); };

const MONTH_SHORT = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
const MONTH_FULL = ['Janvier', 'Février', 'Mars', 'Avril', 'Mai', 'Juin', 'Juillet', 'Août', 'Septembre', 'Octobre', 'Novembre', 'Décembre'];
const DAY_FULL = ['Dimanche', 'Lundi', 'Mardi', 'Mercredi', 'Jeudi', 'Vendredi', 'Samedi'];
const DAY_SHORT = ['Dim', 'Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam']; // indexed by Date#getDay() (0=Sun)
// MonthGrid's cells always start on a Monday (getMonday) — its header row
// needs this Monday-first order, not a getDay()-indexed lookup.
const DAY_SHORT_MONDAY_FIRST = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

type ViewMode = 'jour' | 'semaine' | 'mois';
const VIEW_OPTIONS: { value: ViewMode; label: string }[] = [
    { value: 'jour', label: 'Jour' },
    { value: 'semaine', label: 'Semaine' },
    { value: 'mois', label: 'Mois' },
];

// [start, end] (inclusive, ISO strings) fed to GET /api/calendar for the
// current view + anchor date.
function periodRange(view: ViewMode, anchor: Date): { start: Date; end: Date } {
    if (view === 'jour') {
        const d = startOfDay(anchor);
        return { start: d, end: d };
    }
    if (view === 'semaine') {
        const monday = getMonday(anchor);
        return { start: monday, end: addDays(monday, 6) };
    }
    // mois: full calendar weeks covering the month, like Planning.tsx's grid.
    const first = new Date(anchor.getFullYear(), anchor.getMonth(), 1);
    const last = new Date(anchor.getFullYear(), anchor.getMonth() + 1, 0);
    return { start: getMonday(first), end: addDays(getMonday(addDays(last, 6)), 6) };
}

function periodLabel(view: ViewMode, anchor: Date): string {
    if (view === 'jour') {
        return `${DAY_FULL[anchor.getDay()]} ${anchor.getDate()} ${MONTH_FULL[anchor.getMonth()].toLowerCase()} ${anchor.getFullYear()}`;
    }
    if (view === 'semaine') {
        const monday = getMonday(anchor);
        const sunday = addDays(monday, 6);
        return `${monday.getDate()} ${MONTH_SHORT[monday.getMonth()]} – ${sunday.getDate()} ${MONTH_SHORT[sunday.getMonth()]} ${sunday.getFullYear()}`;
    }
    return `${MONTH_FULL[anchor.getMonth()]} ${anchor.getFullYear()}`;
}

function navigate(view: ViewMode, anchor: Date, dir: 1 | -1): Date {
    if (view === 'jour') return addDays(anchor, dir);
    if (view === 'semaine') return addDays(anchor, dir * 7);
    return new Date(anchor.getFullYear(), anchor.getMonth() + dir, 1);
}

// A leave still awaiting validation shows with reduced opacity + DASHED
// border; a rejected one never renders at all (filtered out before we get
// here — see visibleItems). A chantier "proposition" (candidate date not
// yet picked by the client — see the "chantier à planifier" flow) uses the
// same faded idea but a DOTTED border — deliberately different from the
// leave's dashed one, so "chantier awaiting client confirmation" is never
// mistaken for "leave awaiting admin validation" at a glance. Validated
// against the mockup published for this — see AgendaForm's "Valider cette
// date" for the confirm action that clears it.
const blockClasses = (item: CalendarItem) => {
    if (item.source === 'leave' && item.status === 'PENDING') return 'opacity-60 border-2 border-dashed';
    if (item.source === 'chantier' && item.statut === 'proposition') return 'opacity-55 border-2 border-dotted';
    return 'border border-transparent';
};

const itemsOverlapDay = (items: CalendarItem[], day: Date) => {
    const iso = toISODate(day);
    return items.filter(i => i.date_debut <= iso && i.date_fin >= iso);
};

// What a cell click hands back to the form: the clicked day and, when the
// grid has employee rows (Jour/Semaine), the row's employee — Mois has no
// employee rows (see MonthGrid), so userId stays undefined there.
interface CellClick {
    date: Date;
    userId?: number;
}

interface Props {
    currentUser: User;
    // Same handler App.tsx already gives Dashboard for "open this chantier" —
    // reused here so the detail panel's "Voir le chantier" button lands on
    // the exact same ChantierDetail screen (hours entries, etc.), not a
    // second navigation path.
    onOpenChantier: (chantier: Chantier) => void;
}

// currentUser isn't consumed yet — kept in the props contract for step 8
// (leave validation workflow permission checks).
export const Agenda: React.FC<Props> = ({ currentUser: _currentUser, onOpenChantier }) => {
    const [view, setView] = useState<ViewMode>('semaine');
    const [anchor, setAnchor] = useState<Date>(startOfDay(new Date()));
    const [items, setItems] = useState<CalendarItem[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [holidays, setHolidays] = useState<Record<string, string>>({});
    const isMobile = useIsMobile();

    // Create/edit form, and the read-only detail panel for an existing block.
    const [formState, setFormState] = useState<{ mode: 'create' | 'edit'; initial: AgendaFormValues; editingItem: CalendarItem | null } | null>(null);
    const [detailItem, setDetailItem] = useState<CalendarItem | null>(null);
    const [dropError, setDropError] = useState<string | null>(null);

    const { start, end } = useMemo(() => periodRange(view, anchor), [view, anchor]);

    useEffect(() => {
        api.get('/api/users').then(res => res.ok && res.json()).then((data: User[] | false) => data && setUsers(data));
    }, []);

    // Public holidays (Valais, via the backend's existing /api/holidays/<year>
    // proxy — same source Planning.tsx's old calendar used) for every year
    // touched by the displayed period.
    useEffect(() => {
        const years = Array.from(new Set([start.getFullYear(), end.getFullYear()]));
        Promise.all(years.map(y => api.get(`/api/holidays/${y}`).then(res => res.ok ? res.json() : {})))
            .then(results => setHolidays(Object.assign({}, ...results)));
    }, [start.getFullYear(), end.getFullYear()]);

    const fetchItems = () => {
        api.get(`/api/calendar?start=${toISODate(start)}&end=${toISODate(end)}`)
            .then(res => res.ok && res.json())
            .then((data: CalendarItem[] | false) => data && setItems(data));
    };
    useEffect(fetchItems, [start.getTime(), end.getTime()]);
    // Paused while a form/detail panel is open — a background refetch
    // overwriting the grid mid-edit would be more confusing than useful.
    useAutoRefresh(fetchItems, 30000, !formState && !detailItem);

    // Hide the app shell's nav chrome while a modal is open, same convention
    // as ChantierDetail's entry/edit modals.
    const anyModalOpen = !!formState || !!detailItem;
    useEffect(() => {
        setAppModalOpen(anyModalOpen);
        return () => setAppModalOpen(false);
    }, [anyModalOpen]);
    useEscapeKey(!!formState, () => setFormState(null));
    useEscapeKey(!!detailItem, () => setDetailItem(null));

    useEffect(() => {
        if (!dropError) return;
        const t = setTimeout(() => setDropError(null), 5000);
        return () => clearTimeout(t);
    }, [dropError]);

    // Rejected leaves never render — every employee always shows (no filter,
    // the team's small enough that hiding rows was never actually useful).
    const visibleItems = useMemo(
        () => items.filter(i => !(i.source === 'leave' && i.status === 'REJECTED')),
        [items]
    );

    const days = useMemo(() => {
        if (view === 'jour') return [anchor];
        if (view === 'semaine') return Array.from({ length: 7 }, (_, i) => addDays(getMonday(anchor), i));
        return [];
    }, [view, anchor]);

    const openCreateAt = (cell: CellClick) => {
        const iso = toISODate(cell.date);
        const initial = emptyFormValues(iso, cell.userId ? [cell.userId] : []);
        setFormState({ mode: 'create', initial, editingItem: null });
    };

    const openCreateEmpty = () => {
        setFormState({ mode: 'create', initial: emptyFormValues(toISODate(new Date())), editingItem: null });
    };

    const openDetail = (item: CalendarItem) => setDetailItem(item);

    const openEditFromDetail = () => {
        if (!detailItem) return;
        setFormState({ mode: 'edit', initial: formValuesFromItem(detailItem), editingItem: detailItem });
        setDetailItem(null);
    };

    // Drag&drop: date_debut moves to the dropped cell's date (date_fin shifts
    // to keep the original span); a chantier assignment also moves employee
    // if dropped on a different row (a leave never does — enforced in the
    // drag hook's isValidTarget, not here). On API failure nothing was ever
    // mutated locally (no optimistic update), so "snapping back" is just: do
    // nothing to local state, show the error.
    const handleDropEntry = async (item: CalendarItem, target: DropTarget) => {
        const span = daysBetweenISO(item.date_debut, item.date_fin);
        const newDateDebut = target.date;
        const newDateFin = toISODate(addDays(parseISODate(target.date), span));

        const res = item.source === 'chantier'
            ? await api.put(`/api/calendar/chantier-assignments/${item.id}`, {
                date_debut: newDateDebut, date_fin: newDateFin,
                ...(target.userId !== undefined && target.userId !== item.user_id ? { user_id: target.userId } : {}),
            })
            : await api.put(`/api/calendar/leaves/${item.id}/reschedule`, {
                date_debut: newDateDebut, date_fin: newDateFin,
            });

        if (res.ok) {
            fetchItems();
        } else {
            const body = await res.json().catch(() => ({}));
            setDropError(body.error || "Impossible de déplacer cette entrée.");
        }
    };

    return (
        <div className="space-y-4 sm:space-y-6 animate-fade-in pb-12 h-full flex flex-col relative">
            {/* Header */}
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-3 sm:gap-4">
                <div>
                    <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Calendar className="text-primary" size={28} />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Agenda</span>
                    </h2>
                </div>

                <div className="flex items-center gap-2 sm:gap-4 flex-wrap">
                    <div className="flex items-center gap-1 bg-slate-50 rounded-xl p-1">
                        <button onClick={() => setAnchor(navigate(view, anchor, -1))} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white active:scale-95 transition-all" aria-label="Période précédente">
                            <ChevronLeft size={18} />
                        </button>
                        <span className="px-2 text-xs sm:text-sm font-bold text-slate-900 capitalize min-w-[9rem] sm:min-w-[14rem] text-center">{periodLabel(view, anchor)}</span>
                        <button onClick={() => setAnchor(navigate(view, anchor, 1))} className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-lg text-slate-500 hover:text-slate-900 hover:bg-white active:scale-95 transition-all" aria-label="Période suivante">
                            <ChevronRight size={18} />
                        </button>
                    </div>
                    <button onClick={() => setAnchor(startOfDay(new Date()))} className="min-h-[44px] px-3 py-2 rounded-lg text-xs font-bold text-primary hover:bg-primary/10 active:scale-95 transition-all uppercase tracking-wider">
                        Aujourd'hui
                    </button>

                    <div className="flex bg-slate-50 p-1 rounded-lg">
                        {VIEW_OPTIONS.map(opt => (
                            <button
                                key={opt.value}
                                onClick={() => setView(opt.value)}
                                className={`min-h-[40px] px-3 sm:px-4 py-2 rounded-md text-xs sm:text-sm font-bold active:scale-95 transition-all ${view === opt.value ? 'bg-white text-slate-900 shadow' : 'text-slate-500 hover:text-slate-900'}`}
                            >
                                {opt.label.toUpperCase()}
                            </button>
                        ))}
                    </div>
                </div>
            </div>

            {/* Grid — the employee filter used to be a separate sidebar list
                next to this card, but it just duplicated the names shown in
                ResourceGrid's own row headers (and drifted out of vertical
                sync with them, since rows have variable heights). Dropped
                entirely, not just merged in: every employee always shows —
                a filter that always left everyone checked wasn't earning
                its screen space. */}
            <div className="flex-1 min-h-0 card p-0 overflow-hidden border border-slate-300 flex flex-col">
                {view === 'mois' ? (
                    <MonthGrid anchor={anchor} items={visibleItems} holidays={holidays} isMobile={isMobile} onCellClick={openCreateAt} onBlockClick={openDetail} onDropEntry={handleDropEntry} />
                ) : (
                    <ResourceGrid
                        days={days}
                        items={visibleItems}
                        allUsers={users}
                        holidays={holidays}
                        isMobile={isMobile}
                        onCellClick={openCreateAt}
                        onBlockClick={openDetail}
                        onDropEntry={handleDropEntry}
                    />
                )}
            </div>

            {/* Floating "+" — always opens an empty form, per spec */}
            <button
                onClick={openCreateEmpty}
                className="fixed bottom-6 right-6 lg:right-10 z-30 w-14 h-14 rounded-full bg-primary text-white shadow-xl shadow-primary/30 flex items-center justify-center hover:scale-105 active:scale-95 transition-all"
                aria-label="Nouvelle entrée"
            >
                <Plus size={26} strokeWidth={2.5} />
            </button>

            {dropError && (
                <div className="fixed bottom-24 left-1/2 -translate-x-1/2 z-40 px-4 py-2.5 rounded-full bg-red-600 text-white shadow-lg font-bold text-sm max-w-[90vw] text-center">
                    {dropError}
                </div>
            )}

            {formState && (
                <AgendaFormModal
                    mode={formState.mode}
                    initial={formState.initial}
                    editingItem={formState.editingItem}
                    users={users}
                    sidebarUserIds={users.map(u => u.id)}
                    onClose={() => setFormState(null)}
                    onSaved={fetchItems}
                />
            )}

            {detailItem && (
                <AgendaDetailPanel
                    item={detailItem}
                    users={users}
                    onClose={() => setDetailItem(null)}
                    onEdit={openEditFromDetail}
                    onChanged={fetchItems}
                    onOpenChantier={onOpenChantier}
                />
            )}
        </div>
    );
};

// --- Jour / Semaine: resource grid — one row per employee, columns are
// days, no shared hourly axis. Each day×employee cell just lists that
// employee's entries for that day as small stacked chips (multi-day entries
// pulled out and drawn as one continuous bar spanning their day columns) —
// a spreadsheet-style planner (Tipee), not a time-positioned calendar.
// Every employee always has a row — an earlier cut had a per-row checkbox
// to hide/show, and a matching chip-filter row for Mois, but on a team this
// size nobody ever actually unchecked anyone; dropped both. -------------

const CHIP_HEIGHT = 26; // px, incl. gap — drives the per-employee row height
const MIN_ROW_HEIGHT = 44;
const NAME_COL_WIDTH_DESKTOP = '10rem';
const NAME_COL_WIDTH_MOBILE = '6.5rem';
// Mobile: each day column claims most of the viewport width instead of
// squeezing to fit — the day-columns area becomes horizontally
// swipe-scrollable (native touch scroll, no extra JS) rather than
// compressing 7 columns into illegible slivers.
const DAY_COL_WIDTH_MOBILE = '78vw';
// Desktop: same idea at a smaller scale — a day column never shrinks below
// this, so a chip's text (e.g. "Villa Rochat") stays readable instead of
// truncating to "Villa Ro…" once there are 5-7 columns in a normal-width
// window. Below that, the grid scrolls horizontally (overflow-x-auto on the
// grid root) instead of compressing further.
const DAY_COL_MIN_WIDTH_DESKTOP = '150px';

// Deterministic per-employee color (hash id -> a fixed palette), same
// technique as the backend's per-chantier color (_chantier_color in
// app.py) — kept as a separate palette/frontend-only helper since it's a
// pure UI aid (a dot next to the name), not something the API needs to know.
const EMPLOYEE_COLOR_PALETTE = [
    '#2563EB', '#DC2626', '#059669', '#D97706', '#7C3AED',
    '#0891B2', '#DB2777', '#65A30D', '#EA580C', '#4F46E5',
];
const employeeColor = (id: number) => EMPLOYEE_COLOR_PALETTE[id % EMPLOYEE_COLOR_PALETTE.length];

// dragProps: pointer handlers from useEntryDrag's chipHandlers(item).
// onClick: this SPECIFIC item's tap action, already wrapped in guardClick
// (see useEntryDrag) — a plain prop closure over `item`, not something
// reconstructed from hook-internal ref state, so there's no path for one
// chip's click to ever read another chip's data.
type ChipDragProps = React.HTMLAttributes<HTMLDivElement> & { style?: React.CSSProperties };

const EntryChip: React.FC<{
    item: CalendarItem;
    dragProps: ChipDragProps;
    onClick: (e: React.MouseEvent) => void;
    dragging?: boolean;
    style?: React.CSSProperties;
}> = ({ item, dragProps, onClick, dragging, style }) => (
    <div
        title={`${item.titre}${item.description ? ' — ' + item.description : ''}`}
        {...dragProps}
        onClick={onClick}
        className={`px-2 py-1 rounded text-xs font-bold text-white truncate cursor-grab active:cursor-grabbing leading-tight select-none ${blockClasses(item)} ${dragging ? 'opacity-30' : ''}`}
        style={{ backgroundColor: item.couleur, height: CHIP_HEIGHT - 2, ...dragProps.style, ...style }}
    >
        {!item.toute_la_journee && item.heure_debut && <span className="font-mono opacity-80">{item.heure_debut} </span>}
        {item.titre}
    </div>
);

// Floating clone that follows the pointer while a drag is active.
const DragGhost: React.FC<{ item: CalendarItem; x: number; y: number; width: number }> = ({ item, x, y, width }) => (
    <div
        className="fixed z-[200] pointer-events-none px-2 py-1 rounded text-xs font-bold text-white shadow-2xl scale-105"
        style={{ backgroundColor: item.couleur, left: x, top: y, width, height: CHIP_HEIGHT }}
    >
        {item.titre}
    </div>
);

const holidayName = (holidays: Record<string, string>, day: Date) => holidays[toISODate(day)];

const ResourceGrid: React.FC<{
    days: Date[];
    items: CalendarItem[];
    allUsers: User[];
    holidays: Record<string, string>;
    isMobile: boolean;
    onCellClick: (cell: CellClick) => void;
    onBlockClick: (item: CalendarItem) => void;
    onDropEntry: (item: CalendarItem, target: DropTarget) => void;
}> = ({ days, items, allUsers, holidays, isMobile, onCellClick, onBlockClick, onDropEntry }) => {
    const today = startOfDay(new Date());
    const nameColWidth = isMobile ? NAME_COL_WIDTH_MOBILE : NAME_COL_WIDTH_DESKTOP;
    const dayGridColumns = `repeat(${days.length}, minmax(${isMobile ? DAY_COL_WIDTH_MOBILE : DAY_COL_MIN_WIDTH_DESKTOP}, 1fr))`;
    const headerGridColumns = `${nameColWidth} ${dayGridColumns}`;

    const { drag, chipHandlers, isDragging, guardClick, shouldIgnoreClick } = useEntryDrag(onDropEntry);

    // Single-day entries (date_debut === date_fin) render inside their one
    // day cell. A multi-day entry is pulled out and drawn once, as an
    // absolutely-positioned bar overlaying the day-cells grid it spans
    // (left/width in % of the grid, since all day columns are equal width)
    // — that way it sits on the SAME droppable cells the single-day chips
    // use, instead of needing its own separate hit-testable layer.
    const singleDayItemsFor = (userId: number, day: Date) =>
        itemsOverlapDay(items, day).filter(i => i.user_id === userId && i.date_debut === i.date_fin);

    const dayIndexClamped = (dateStr: string, edge: 'start' | 'end') => {
        const idx = days.findIndex(d => toISODate(d) === dateStr);
        if (idx !== -1) return idx;
        return edge === 'start' ? 0 : days.length - 1;
    };

    // Greedy interval packing: entries whose date ranges don't overlap share
    // a lane; an overlapping one bumps to the next lane down.
    const packLanes = (multiDay: CalendarItem[]) => {
        const sorted = [...multiDay].sort((a, b) => a.date_debut.localeCompare(b.date_debut));
        const laneEnds: string[] = [];
        return sorted.map(item => {
            let lane = laneEnds.findIndex(end => end < item.date_debut);
            if (lane === -1) { lane = laneEnds.length; laneEnds.push(item.date_fin); }
            else laneEnds[lane] = item.date_fin;
            return { item, lane };
        });
    };

    return (
        // overflow-x-auto here (not per sub-section) so the header row and
        // every employee row's day columns scroll together as one unit —
        // the name column stays put via `sticky left-0` on its own cells.
        <div className="flex flex-col h-full min-h-0 overflow-x-auto">
            {/* Day headers */}
            <div className="grid border-b border-slate-300 bg-slate-50 shrink-0" style={{ gridTemplateColumns: headerGridColumns }}>
                <div className="sticky left-0 z-10 bg-slate-50 p-2 text-[10px] font-bold text-slate-400 uppercase tracking-widest self-center">Employé</div>
                {days.map(d => {
                    const isToday = d.getTime() === today.getTime();
                    const holiday = holidayName(holidays, d);
                    return (
                        <div key={d.toISOString()} title={holiday} className={`p-2 text-center border-l border-slate-200 ${holiday ? 'bg-amber-100/70' : isToday ? 'bg-primary/10' : ''}`}>
                            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest">{DAY_SHORT[d.getDay()]}</div>
                            <div className={`text-lg font-black ${isToday ? 'text-primary' : 'text-slate-900'}`}>{d.getDate()}</div>
                            {holiday && <div className="text-[9px] font-bold text-amber-700 truncate">{holiday}</div>}
                        </div>
                    );
                })}
            </div>

            {/* Employee rows — every employee always gets a full row. */}
            <div className="flex-1 overflow-y-auto divide-y divide-slate-200">
                {allUsers.map(emp => {
                    const empItems = items.filter(i => i.user_id === emp.id);
                    const multiDayLaned = packLanes(empItems.filter(i => i.date_debut !== i.date_fin));
                    const laneCount = multiDayLaned.reduce((max, { lane }) => Math.max(max, lane + 1), 0);
                    const maxSingleDayCount = Math.max(1, ...days.map(d => singleDayItemsFor(emp.id, d).length));
                    const barsHeight = laneCount * CHIP_HEIGHT;
                    const cellsHeight = Math.max(MIN_ROW_HEIGHT, maxSingleDayCount * CHIP_HEIGHT + 8);
                    const rowHeight = barsHeight + cellsHeight;

                    return (
                        // flex, not one big grid spanning name+day columns: the
                        // day-cells portion needs its OWN `position:relative`
                        // containing block so the multi-day bars' left/width
                        // percentages resolve against the full day-columns
                        // width — nesting them inside a single day-cell (as a
                        // first cut did) anchored the % math to that one
                        // cell's own width instead, scrambling the bars.
                        <div key={emp.id} className="flex" style={{ height: rowHeight }}>
                            <div
                                style={{ width: nameColWidth }}
                                className="shrink-0 sticky left-0 z-10 p-1.5 flex items-center gap-1.5 text-sm font-bold truncate bg-slate-50/95 border-r border-slate-200 text-slate-700"
                            >
                                {/* Deterministic per-employee color dot — same hash-into-
                                    a-fixed-palette technique the backend uses for chantier
                                    colors (_chantier_color in app.py), just a separate
                                    frontend-only palette since this is a pure UI aid, no
                                    API round-trip needed. */}
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: employeeColor(emp.id) }} />
                                <span className="truncate">{emp.username}</span>
                            </div>

                            <div className="relative flex-1 grid min-w-0" style={{ gridTemplateColumns: dayGridColumns }}>
                                    {/* Multi-day bars — placed via `grid-column` on the SAME grid
                                        (and the same column track definition, dayGridColumns) the
                                        day cells below use, not a manual left/width % calculation.
                                        % math looked right (verified: exactly startIdx/7 and
                                        span/7) but still drifted from the real column edges by a
                                        few px per column — border-box rounding/scrollbar-width
                                        accumulation, the usual reason hand-rolled % never quite
                                        matches actual track boundaries. grid-column reads the
                                        browser's own column edges, so it can't drift regardless of
                                        border width, box-sizing, or column count — pixel-perfect by
                                        construction instead of by calculation. A grid item that's
                                        also `position: absolute` still sizes to the grid area given
                                        by grid-column/grid-row (that's spec, not a hack) — `left:0;
                                        right:0` stretches it to fill that area; only `top` (lane
                                        stacking) needs a manual value. */}
                                    {multiDayLaned.map(({ item, lane }) => {
                                        const startIdx = dayIndexClamped(item.date_debut, 'start');
                                        const endIdx = dayIndexClamped(item.date_fin, 'end');
                                        return (
                                            <div
                                                key={`${item.source}-${item.id}`}
                                                className="absolute px-1"
                                                style={{ gridColumn: `${startIdx + 1} / ${endIdx + 2}`, left: 0, right: 0, top: lane * CHIP_HEIGHT + 4, zIndex: 5 }}
                                            >
                                                <EntryChip item={item} dragProps={chipHandlers(item)} onClick={guardClick(() => onBlockClick(item))} dragging={isDragging(item)} />
                                            </div>
                                        );
                                    })}
                                    {days.map(d => {
                                        const dayItems = singleDayItemsFor(emp.id, d);
                                        const isToday = d.getTime() === today.getTime();
                                        const holiday = holidayName(holidays, d);
                                        const isDropHover = drag?.over?.date === toISODate(d) && drag.over.userId === emp.id;
                                        return (
                                            <div
                                                key={d.toISOString()}
                                                data-drop-date={toISODate(d)}
                                                data-drop-user={emp.id}
                                                onClick={() => { if (!shouldIgnoreClick()) onCellClick({ date: d, userId: emp.id }); }}
                                                style={{ paddingTop: barsHeight || undefined }}
                                                className={`p-1 space-y-0.5 border-l border-slate-200 cursor-pointer hover:bg-slate-50 transition-colors ${holiday ? 'bg-amber-50/60' : isToday ? 'bg-primary/5' : ''} ${isDropHover ? (drag?.valid ? 'ring-2 ring-inset ring-primary bg-primary/10' : 'ring-2 ring-inset ring-red-400 bg-red-50') : ''}`}
                                            >
                                                {dayItems.map(i => (
                                                    <EntryChip key={`${i.source}-${i.id}`} item={i} dragProps={chipHandlers(i)} onClick={guardClick(() => onBlockClick(i))} dragging={isDragging(i)} />
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                        </div>
                    );
                })}
                {allUsers.length === 0 && (
                    <div className="p-8 text-center text-sm text-slate-400 italic">Aucun employé.</div>
                )}
            </div>

            {drag && <DragGhost item={drag.item} x={drag.x} y={drag.y} width={drag.width} />}
        </div>
    );
};

// --- Mois: compact per-day cells, ALL checked employees aggregated into
// the same cell (not one row per employee like Jour/Semaine's ResourceGrid).
// Deliberate difference from Tipee, kept for legibility: a 7-column x
// 6-week grid has no room for N employee sub-rows per day without either
// tiny unreadable text or a wide horizontal scroll. Each chip's color still
// identifies its chantier/absence type; hovering (title attr) shows who via
// the block's own detail on click. Flag if you want per-employee rows here
// too — happy to revisit at the cost of month-view density. On mobile the
// same 7 columns just get wider (swipe-scrollable), same idea as
// ResourceGrid, instead of trying to compress a week into ~50px slivers. --

const MonthGrid: React.FC<{
    anchor: Date;
    items: CalendarItem[];
    holidays: Record<string, string>;
    isMobile: boolean;
    onCellClick: (cell: CellClick) => void;
    onBlockClick: (item: CalendarItem) => void;
    onDropEntry: (item: CalendarItem, target: DropTarget) => void;
}> = ({ anchor, items, holidays, isMobile, onCellClick, onBlockClick, onDropEntry }) => {
    const { start } = periodRange('mois', anchor);
    const weeks = 6;
    const cells = Array.from({ length: weeks * 7 }, (_, i) => addDays(start, i));
    const today = startOfDay(new Date());
    const currentMonth = anchor.getMonth();
    const gridColumns = isMobile ? `repeat(7, minmax(${DAY_COL_WIDTH_MOBILE}, 1fr))` : 'repeat(7, minmax(0, 1fr))';

    // Month view has no employee rows, so a drop here never carries a
    // userId — the drag hook then only ever validates/moves the date,
    // for both chantier assignments and leaves alike.
    const { drag, chipHandlers, isDragging, guardClick, shouldIgnoreClick } = useEntryDrag(onDropEntry);

    return (
        <div className="flex flex-col h-full min-h-0 overflow-x-auto">
            <div className="grid bg-slate-50 border-b border-slate-300" style={{ gridTemplateColumns: gridColumns }}>
                {DAY_SHORT_MONDAY_FIRST.map((d, i) => (
                    <div key={i} className="p-2 text-center text-[10px] font-bold text-slate-400 uppercase tracking-widest">{d}</div>
                ))}
            </div>
            <div className="grid flex-1 overflow-y-auto" style={{ gridTemplateColumns: gridColumns }}>
                {cells.map(d => {
                    const dayItems = itemsOverlapDay(items, d);
                    const isToday = d.getTime() === today.getTime();
                    const inMonth = d.getMonth() === currentMonth;
                    const holiday = holidayName(holidays, d);
                    const iso = toISODate(d);
                    const isDropHover = drag?.over?.date === iso;
                    return (
                        <div
                            key={d.toISOString()}
                            data-drop-date={iso}
                            onClick={() => { if (!shouldIgnoreClick()) onCellClick({ date: d }); }}
                            title={holiday}
                            className={`min-h-[6rem] border-b border-r border-slate-200 p-1.5 space-y-1 cursor-pointer hover:bg-slate-50 transition-colors ${holiday ? 'bg-amber-50' : inMonth ? 'bg-white' : 'bg-slate-50/50'} ${isToday && !holiday ? 'bg-primary/5' : ''} ${isDropHover ? (drag?.valid ? 'ring-2 ring-inset ring-primary bg-primary/10' : 'ring-2 ring-inset ring-red-400 bg-red-50') : ''}`}
                        >
                            <div className="flex items-center justify-between gap-1">
                                <span className={`text-xs font-mono font-bold ${isToday ? 'text-primary' : inMonth ? 'text-slate-400' : 'text-slate-300'}`}>{d.getDate()}</span>
                                {holiday && <span className="text-[9px] font-bold text-amber-700 truncate">{holiday}</span>}
                            </div>
                            <div className="space-y-0.5">
                                {dayItems.slice(0, 3).map(i => (
                                    <EntryChip key={`${i.source}-${i.id}`} item={i} dragProps={chipHandlers(i)} onClick={guardClick(() => onBlockClick(i))} dragging={isDragging(i)} />
                                ))}
                                {dayItems.length > 3 && (
                                    <div className="text-[10px] text-slate-400 font-bold px-1">+{dayItems.length - 3}</div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            {drag && <DragGhost item={drag.item} x={drag.x} y={drag.y} width={drag.width} />}
        </div>
    );
};
