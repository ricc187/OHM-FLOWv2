import React, { useEffect, useMemo, useState } from 'react';
import { api } from '../api';
import { D_POS, D_NEG, formatPct, StatTile, LegendSwatch } from './statsUi';

// Onglet "RH & Planning" de la page Statistiques — absentéisme, effectifs,
// heures planifié vs réel. Même méthode dataviz que l'onglet Financier
// (GlobalStats.tsx) : forme choisie par le job des données, couleur jamais
// décorative, légende dès 2 séries, table en repli pour le détail complet.

// Mirroir exact de LEAVE_TYPE_COLORS (backend/app.py) — une seule palette
// pour les absences dans toute l'app (déjà utilisée pour les chips Agenda).
const LEAVE_TYPE_COLORS: Record<string, string> = {
    CONGE: '#8B5CF6',
    MALADIE: '#F87171',
    ABSENCE: '#94A3B8',
    ARMEE: '#4B5563',
    CONGE_PAT_MAT: '#F472B6',
    DEMENAGEMENT: '#FB923C',
};

const ROLE_LABELS: Record<string, string> = { admin: 'Admin', depanneur: 'Dépanneur', user: 'Employé' };

type RangeKey = '3M' | '6M' | '1Y' | 'ALL';
const RANGE_MONTHS: Record<Exclude<RangeKey, 'ALL'>, number> = { '3M': 3, '6M': 6, '1Y': 12 };

// "ALL" a besoin de bornes concrètes (les endpoints exigent start/end) — 10
// ans en arrière couvre large sans avoir à interroger la date la plus
// ancienne en base.
const periodFor = (range: RangeKey): { start: string; end: string } => {
    const end = new Date();
    const start = new Date(end);
    if (range === 'ALL') start.setFullYear(start.getFullYear() - 10);
    else start.setMonth(start.getMonth() - RANGE_MONTHS[range]);
    const iso = (d: Date) => d.toISOString().slice(0, 10);
    return { start: iso(start), end: iso(end) };
};

interface AbsenteeismData {
    working_days_period: number; headcount: number; total_working_person_days: number;
    absence_days_total: number; rate: number | null;
    by_type: { type: string; label: string; days: number }[];
    by_employee: { user_id: number; user_name: string; days: number }[];
}
interface HeadcountData { total: number; by_role: { role: string; count: number }[] }
interface PlannedRow { id: number; label: string; planned: number; actual: number; delta: number }
interface PlannedVsActualData { group_by: string; rows: PlannedRow[] }

// --- Barre simple (pas de polarité) — répartition par type d'absence ---
const SingleBarList: React.FC<{ data: { label: string; value: number; color: string }[]; unit: string }> = ({ data, unit }) => {
    if (data.length === 0) return <div className="text-sm text-slate-400 italic py-8 text-center">Aucune absence sur la période.</div>;
    const max = Math.max(...data.map(d => d.value), 1);
    return (
        <div className="space-y-2.5">
            {data.map(d => (
                <div key={d.label} className="flex items-center gap-3">
                    <div className="w-32 sm:w-40 shrink-0 text-xs font-medium text-slate-700 truncate text-right" title={d.label}>{d.label}</div>
                    <div className="flex-1 relative h-6">
                        <div className="absolute inset-y-0 left-0 rounded-sm transition-[width] duration-500 ease-out"
                            style={{ backgroundColor: d.color, width: `${Math.max((d.value / max) * 100, d.value > 0 ? 2 : 0)}%` }} />
                        <div className="absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums text-slate-700"
                            style={{ left: `calc(${(d.value / max) * 100}% + 8px)` }}>
                            {d.value.toLocaleString('fr-CH')} {unit}
                        </div>
                    </div>
                </div>
            ))}
        </div>
    );
};

// --- Barres divergentes — planifié vs réel (delta), même pattern que "Marge
// par chantier" côté Financier (GlobalStats.tsx), adapté aux heures. ---
const HoursDivergingChart: React.FC<{ data: PlannedRow[]; maxAbsOverride?: number }> = ({ data, maxAbsOverride }) => {
    const [hover, setHover] = useState<number | null>(null);
    if (data.length === 0) return <div className="text-sm text-slate-400 italic py-8 text-center">Aucune donnée sur la période.</div>;
    const maxAbs = maxAbsOverride ?? Math.max(...data.map(r => Math.abs(r.delta)), 1);
    // Plafonné à 40% (pas 50%) du demi-espace : laisse toujours de la place
    // pour l'étiquette de valeur à côté de la barre la plus longue, même
    // quand — comme ici — toutes les valeurs sont du même signe et proches
    // du max (rien ne "tire" l'échelle vers un petit delta).
    const MAX_PCT = 40;

    return (
        <div className="space-y-2.5">
            {data.map((r, i) => {
                const pct = Math.min(Math.abs(r.delta) / maxAbs, 1) * MAX_PCT;
                const positive = r.delta >= 0;
                return (
                    <div key={r.id} className="group relative flex items-center gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                        <div className="w-32 sm:w-44 shrink-0 text-xs font-medium text-slate-700 truncate text-right" title={r.label}>{r.label}</div>
                        <div className="flex-1 relative h-6">
                            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                            <div className="absolute inset-y-0 rounded-sm transition-[width] duration-500 ease-out"
                                style={{ backgroundColor: positive ? D_POS : D_NEG, width: `${pct}%`, left: positive ? '50%' : `${50 - pct}%` }} />
                            <div className="absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums whitespace-nowrap text-slate-700"
                                style={{
                                    left: positive ? `calc(50% + ${pct}% + 6px)` : undefined,
                                    right: positive ? undefined : `calc(50% + ${pct}% + 6px)`,
                                }}>
                                {positive ? '+' : ''}{r.delta.toLocaleString('fr-CH')} h
                            </div>
                        </div>
                        {hover === i && (
                            <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none whitespace-nowrap">
                                <div className="font-bold">{r.label}</div>
                                <div className="text-slate-300">Planifié : <span className="font-bold text-white">{r.planned} h</span></div>
                                <div className="text-slate-300">Réel : <span className="font-bold text-white">{r.actual} h</span></div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

export const RhPlanningTab: React.FC = () => {
    const [range, setRange] = useState<RangeKey>('1Y');
    const [groupBy, setGroupBy] = useState<'chantier' | 'user'>('chantier');
    const [absence, setAbsence] = useState<AbsenteeismData | null>(null);
    const [headcount, setHeadcount] = useState<HeadcountData | null>(null);
    const [planned, setPlanned] = useState<PlannedVsActualData | null>(null);
    const [tableSearch, setTableSearch] = useState('');

    const { start, end } = useMemo(() => periodFor(range), [range]);

    useEffect(() => {
        api.get('/api/stats/headcount').then(async r => { if (r.ok) setHeadcount(await r.json()); });
    }, []);

    useEffect(() => {
        api.get(`/api/stats/absenteeism?start=${start}&end=${end}`).then(async r => { if (r.ok) setAbsence(await r.json()); });
    }, [start, end]);

    useEffect(() => {
        api.get(`/api/stats/planned-vs-actual-hours?start=${start}&end=${end}&group_by=${groupBy}`)
            .then(async r => { if (r.ok) setPlanned(await r.json()); });
    }, [start, end, groupBy]);

    const rows = planned?.rows ?? [];
    const splitRows = rows.length > 10;
    const rowsTop = splitRows ? rows.slice(0, 5) : rows;
    const rowsBottom = splitRows ? rows.slice(-5) : [];
    const sharedMax = splitRows ? Math.max(...[...rowsTop, ...rowsBottom].map(r => Math.abs(r.delta)), 1) : undefined;

    const filteredRows = tableSearch.trim()
        ? rows.filter(r => r.label.toLowerCase().includes(tableSearch.trim().toLowerCase()))
        : rows;

    const RangePicker = (
        <div className="flex p-1 bg-slate-100 rounded-lg overflow-hidden">
            {(['3M', '6M', '1Y', 'ALL'] as const).map(r => (
                <button key={r} onClick={() => setRange(r)}
                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${range === r ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                    {r}
                </button>
            ))}
        </div>
    );

    return (
        <div className="space-y-8">
            <div className="flex items-center justify-between flex-wrap gap-3">
                <p className="text-xs text-slate-400">Période : {start} → {end}</p>
                {RangePicker}
            </div>

            {/* ===== Effectifs ===== */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    label="Effectifs"
                    value={headcount?.total ?? '—'}
                    sub={headcount ? headcount.by_role.map(r => `${ROLE_LABELS[r.role] || r.role} : ${r.count}`).join(' · ') : undefined}
                />
                <StatTile
                    label="Taux d'absentéisme"
                    value={absence ? formatPct(absence.rate) : '—'}
                    sub={absence ? `${absence.absence_days_total} j d'absence / ${absence.total_working_person_days} j-personnes ouvrés` : undefined}
                />
                <StatTile
                    label="Jours ouvrés (période)"
                    value={absence?.working_days_period ?? '—'}
                />
                <StatTile
                    label="Employés concernés"
                    value={absence?.by_employee.length ?? '—'}
                    sub={absence ? `sur ${absence.headcount} employé(s)` : undefined}
                />
            </div>

            {/* ===== Absentéisme par type / employé ===== */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="card">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-1">Absences par type</h3>
                    <p className="text-xs text-slate-400 mb-5">Jours ouvrés, congés approuvés uniquement.</p>
                    <SingleBarList
                        unit="j"
                        data={(absence?.by_type ?? []).map(t => ({ label: t.label, value: t.days, color: LEAVE_TYPE_COLORS[t.type] || '#94A3B8' }))}
                    />
                    {absence && absence.by_type.length > 0 && (
                        <div className="flex flex-wrap gap-x-4 gap-y-1 mt-5 pt-4 border-t border-slate-100">
                            {absence.by_type.map(t => (
                                <LegendSwatch key={t.type} color={LEAVE_TYPE_COLORS[t.type] || '#94A3B8'} label={t.label} />
                            ))}
                        </div>
                    )}
                </div>

                <div className="card p-0 overflow-hidden">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide px-6 pt-6 mb-1">Absences par employé</h3>
                    <p className="text-xs text-slate-400 px-6 mb-4">Jours ouvrés sur la période.</p>
                    <div className="overflow-x-auto">
                        <table className="w-full text-sm min-w-[320px]">
                            <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[11px] border-y border-slate-100">
                                <tr>
                                    <th className="p-3 pl-6 text-left">Employé</th>
                                    <th className="p-3 pr-6 text-right">Jours</th>
                                </tr>
                            </thead>
                            <tbody className="divide-y divide-slate-100 tabular-nums">
                                {(absence?.by_employee ?? []).map(e => (
                                    <tr key={e.user_id} className="hover:bg-slate-50/70">
                                        <td className="p-3 pl-6 font-medium text-slate-700 whitespace-nowrap">{e.user_name}</td>
                                        <td className="p-3 pr-6 text-right font-bold text-slate-900">{e.days}</td>
                                    </tr>
                                ))}
                                {(!absence || absence.by_employee.length === 0) && (
                                    <tr><td colSpan={2} className="p-6 text-center text-slate-400 italic">Aucune absence sur la période.</td></tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                </div>
            </div>

            {/* ===== Heures planifié vs réel ===== */}
            <div className="card">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Heures — planifié vs réel</h3>
                    <div className="flex items-center gap-4">
                        <LegendSwatch color={D_POS} label="Réel ≥ planifié" />
                        <LegendSwatch color={D_NEG} label="Réel < planifié" />
                        <div className="flex p-1 bg-slate-100 rounded-lg overflow-hidden">
                            {(['chantier', 'user'] as const).map(g => (
                                <button key={g} onClick={() => setGroupBy(g)}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${groupBy === g ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                                    {g === 'chantier' ? 'Par chantier' : 'Par employé'}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <p className="text-xs text-slate-400 mb-5">
                    Planifié = affectations confirmées (les propositions non validées n'engagent personne) converties en heures via l'horaire de travail. Réel = heures saisies (Suivi).
                </p>
                {splitRows ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                        <div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Le plus au-dessus du prévu</div>
                            <HoursDivergingChart data={rowsTop} maxAbsOverride={sharedMax} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Le plus en-dessous du prévu</div>
                            <HoursDivergingChart data={rowsBottom} maxAbsOverride={sharedMax} />
                        </div>
                    </div>
                ) : (
                    <HoursDivergingChart data={rows} />
                )}
            </div>

            {/* ===== Table détail (repli accessible) ===== */}
            {rows.length > 0 && (
                <div className="card p-0 overflow-x-auto">
                    <div className="flex items-center justify-between flex-wrap gap-3 px-6 pt-6 pb-4">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">
                            Détail {groupBy === 'chantier' ? 'par chantier' : 'par employé'}
                        </h3>
                        {rows.length > 8 && (
                            <input
                                type="text" value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                                placeholder={groupBy === 'chantier' ? 'Rechercher un chantier…' : 'Rechercher un employé…'}
                                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:border-ohm-primary focus:outline-none w-48"
                            />
                        )}
                    </div>
                    <table className="w-full text-sm min-w-[520px]">
                        <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[11px] border-y border-slate-100">
                            <tr>
                                <th className="p-3 pl-6 text-left">{groupBy === 'chantier' ? 'Chantier' : 'Employé'}</th>
                                <th className="p-3 text-right">Planifié</th>
                                <th className="p-3 text-right">Réel</th>
                                <th className="p-3 pr-6 text-right">Écart</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                            {filteredRows.map(r => (
                                <tr key={r.id} className="hover:bg-slate-50/70">
                                    <td className="p-3 pl-6 font-medium text-slate-700 whitespace-nowrap">{r.label}</td>
                                    <td className="p-3 text-right text-slate-600">{r.planned} h</td>
                                    <td className="p-3 text-right text-slate-600">{r.actual} h</td>
                                    <td className={`p-3 pr-6 text-right font-bold ${r.delta >= 0 ? 'text-slate-900' : 'text-red-600'}`}>
                                        {r.delta >= 0 ? '+' : ''}{r.delta} h
                                    </td>
                                </tr>
                            ))}
                            {filteredRows.length === 0 && (
                                <tr><td colSpan={4} className="p-6 text-center text-slate-400 italic">Aucun résultat.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
