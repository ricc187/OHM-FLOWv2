import React, { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../api';
import { SlidingTabs } from './ui/SlidingTabs';
import { RhPlanningTab } from './RhPlanningTab';
import { D_POS, D_NEG, GRID, formatPct, StatTile, LegendSwatch } from './statsUi';

type StatsTab = 'FINANCIER' | 'RH';

// Page "Statistiques" — vue d'ensemble opérationnelle (heures dans le
// temps) + vue financière agrégée (marge, avancement, CA prévu/réel par
// chantier), construite selon la méthode dataviz : forme choisie par le job
// des données, couleur categorical/diverging/status assignée par rôle (jamais
// décorative), légende dès 2 séries, tooltip au survol, table en repli.
// D_POS/D_NEG/GRID/StatTile/LegendSwatch/formatPct partagés avec RhPlanningTab
// (onglet RH & Planning) — voir statsUi.tsx.

// Status (avancement vs budget) — mêmes seuils que l'onglet Finances d'un chantier.
const S_GOOD = '#16a34a';
const S_WARN = '#f59e0b';
const S_CRIT = '#ef4444';
const S_NONE = '#cbd5e1';

interface MonthlyStats { month: string; hours: number; }
interface StatsData {
    total_entries: number;
    total_hours: number;
    active_chantiers: number;
    history: MonthlyStats[];
    comparison?: { hours_growth: number; hours_curr: number; hours_last: number };
}

interface ChantierFinancierStat {
    id: number; nom: string; status: string;
    ca_prevu: number; ca_reel: number;
    marge_prevue: number; marge_reelle: number;
    pct_marge_prevue: number | null; pct_marge_reelle: number | null;
    debourse_sec_prevu: number; debourse_sec_reel: number;
    pct_avancement_ca: number | null; pct_avancement_materiel: number | null;
    pct_avancement_mo: number | null; pct_avancement_debourse_sec: number | null;
}
interface FinancierTotals {
    chantiers_count: number; chantiers_positive_marge: number; chantiers_negative_marge: number;
    ca_prevu: number; ca_reel: number;
    marge_prevue: number; marge_reelle: number; pct_marge_reelle: number | null;
    debourse_sec_prevu: number; debourse_sec_reel: number;
    pct_avancement_ca: number | null; pct_avancement_materiel: number | null;
    pct_avancement_mo: number | null; pct_avancement_debourse_sec: number | null;
}
interface FinancierStatsData { chantiers: ChantierFinancierStat[]; totals: FinancierTotals | null; }

const formatCHF = (v: number | null | undefined, compact = false) => {
    if (v == null) return '—';
    if (compact) {
        const abs = Math.abs(v);
        if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-CH', { maximumFractionDigits: 1 })}M`;
        if (abs >= 10_000) return `${(v / 1_000).toLocaleString('fr-CH', { maximumFractionDigits: 0 })}k`;
    }
    return v.toLocaleString('fr-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};
const formatMonth = (ym: string) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    return new Date(parseInt(y), parseInt(m) - 1).toLocaleString('fr-FR', { month: 'short' }).replace('.', '');
};
const statusColor = (pct: number | null) => pct == null ? S_NONE : pct > 1 ? S_CRIT : pct >= 0.9 ? S_WARN : S_GOOD;

// --- Donut d'avancement global (réel/prévu, sommé sur tous les chantiers) ---
const AvancementDonut: React.FC<{ label: string; pct: number | null }> = ({ label, pct }) => {
    const size = 100, stroke = 10, r = (size - stroke) / 2, c = 2 * Math.PI * r;
    const clamped = pct == null ? 0 : Math.max(0, Math.min(pct, 1));
    const color = statusColor(pct);
    return (
        <div className="flex flex-col items-center gap-2">
            <div className="relative" style={{ width: size, height: size }}>
                <svg width={size} height={size} className="-rotate-90">
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={GRID} strokeWidth={stroke} />
                    <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth={stroke}
                        strokeDasharray={c} strokeDashoffset={c * (1 - clamped)} strokeLinecap="round"
                        className="transition-[stroke-dashoffset] duration-500 ease-out" />
                </svg>
                <div className="absolute inset-0 flex items-center justify-center">
                    {/* Le texte reste toujours en encre neutre — l'identité de statut est
                        portée par l'anneau (le "mark"), jamais par la couleur du texte. */}
                    <span className="text-lg font-bold text-slate-900">{formatPct(pct)}</span>
                </div>
            </div>
            <span className="text-xs font-bold text-slate-600 uppercase tracking-wide text-center">{label}</span>
        </div>
    );
};

// --- Marge par chantier — barres divergentes depuis un zéro central (job = polarité) ---
// `maxAbsOverride` : quand on affiche deux sous-listes côte à côte (meilleures
// / moins bonnes marges), les deux doivent partager la même échelle pour
// rester comparables — sinon chaque moitié se recale sur son propre max.
const MargeDivergingChart: React.FC<{ data: ChantierFinancierStat[]; maxAbsOverride?: number }> = ({ data, maxAbsOverride }) => {
    const [hover, setHover] = useState<number | null>(null);
    if (data.length === 0) return <div className="text-sm text-slate-400 italic py-8 text-center">Aucun chantier avec un prévisionnel configuré.</div>;
    const maxAbs = maxAbsOverride ?? Math.max(...data.map(c => Math.abs(c.marge_reelle)), 1);

    return (
        <div className="space-y-2.5">
            {data.map((c, i) => {
                const pct = Math.min(Math.abs(c.marge_reelle) / maxAbs, 1) * 50; // % of half-width
                const positive = c.marge_reelle >= 0;
                return (
                    <div key={c.id} className="group relative flex items-center gap-3" onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)}>
                        <div className="w-28 sm:w-36 shrink-0 text-xs font-medium text-slate-700 truncate text-right" title={c.nom}>{c.nom}</div>
                        <div className="flex-1 relative h-6">
                            {/* Zero baseline, centered */}
                            <div className="absolute inset-y-0 left-1/2 w-px bg-slate-300" />
                            <div
                                className="absolute inset-y-0 rounded-sm transition-[width] duration-500 ease-out"
                                style={{
                                    backgroundColor: positive ? D_POS : D_NEG,
                                    width: `${pct}%`,
                                    left: positive ? '50%' : `${50 - pct}%`,
                                }}
                            />
                            {/* Value at the tip — ink, not the bar's color: the bar (the
                                mark) carries polarity, the minus sign carries it in text. */}
                            <div
                                className="absolute inset-y-0 flex items-center text-[11px] font-bold tabular-nums whitespace-nowrap text-slate-700"
                                style={{
                                    left: positive ? `calc(50% + ${pct}% + 6px)` : undefined,
                                    right: positive ? undefined : `calc(50% + ${pct}% + 6px)`,
                                }}
                            >
                                {formatCHF(c.marge_reelle, true)}
                            </div>
                        </div>
                        {hover === i && (
                            <div className="absolute z-20 left-1/2 -translate-x-1/2 bottom-full mb-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none whitespace-nowrap">
                                <div className="font-bold">{c.nom}</div>
                                <div className="text-slate-300">Marge réelle : <span className="font-bold text-white">{formatCHF(c.marge_reelle)} CHF</span> ({formatPct(c.pct_marge_reelle)})</div>
                                <div className="text-slate-400">Prévue : {formatCHF(c.marge_prevue)} CHF</div>
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};

// --- CA prévu vs réel — nuage de points (scale à N'importe quel nombre de
// chantiers, contrairement à une barre par chantier qui devient illisible
// passé une dizaine). Un chantier = un point ; la diagonale est la référence
// "facturé = prévu" ; la couleur (diverging) dit juste de quel côté il est. ---
const CaScatterChart: React.FC<{ data: ChantierFinancierStat[] }> = ({ data }) => {
    const [hover, setHover] = useState<number | null>(null);
    if (data.length === 0) return null;

    const width = 600, height = 420, pad = 46;
    const maxVal = Math.max(...data.flatMap(c => [c.ca_prevu, c.ca_reel]), 1) * 1.08;
    const sx = (v: number) => pad + (v / maxVal) * (width - pad - 16);
    const sy = (v: number) => (height - pad) - (v / maxVal) * (height - pad - 16);

    return (
        <div className="relative w-full" style={{ height: height + 24 }}>
            <svg viewBox={`0 0 ${width} ${height}`} className="w-full overflow-visible" style={{ height }}>
                <line x1={pad} y1={height - pad} x2={width} y2={height - pad} stroke={GRID} strokeWidth="1" />
                <line x1={pad} y1={height - pad} x2={pad} y2={0} stroke={GRID} strokeWidth="1" />
                {/* Référence "facturé = prévu" */}
                <line x1={sx(0)} y1={sy(0)} x2={sx(maxVal)} y2={sy(maxVal)} stroke="#c3c2b7" strokeWidth="1.5" strokeDasharray="5,5" />
                {data.map((c, i) => {
                    const x = sx(c.ca_prevu), y = sy(c.ca_reel);
                    const over = c.ca_reel >= c.ca_prevu;
                    const dim = hover !== null && hover !== i;
                    return (
                        <g key={c.id} onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} className="cursor-pointer">
                            {/* Zone de survol >= 24px, bien plus grande que le point rendu */}
                            <circle cx={x} cy={y} r={12} fill="transparent" />
                            <circle cx={x} cy={y} r={5} fill={over ? D_POS : D_NEG} stroke="#fff" strokeWidth="1.5"
                                opacity={dim ? 0.3 : 1} className="transition-opacity duration-150" />
                        </g>
                    );
                })}
            </svg>
            <div className="absolute bottom-0 left-1/2 -translate-x-1/2 text-[10px] text-slate-400 font-mono uppercase tracking-wide">CA prévu →</div>
            <div className="absolute top-1/2 left-0 -translate-y-1/2 -rotate-90 text-[10px] text-slate-400 font-mono uppercase tracking-wide origin-left">CA réel →</div>
            {hover !== null && (
                <div
                    className="absolute z-20 bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none whitespace-nowrap"
                    style={{
                        left: `${(sx(data[hover].ca_prevu) / width) * 100}%`,
                        top: `${(sy(data[hover].ca_reel) / height) * 100}%`,
                        transform: 'translate(-50%, -135%)',
                    }}
                >
                    <div className="font-bold">{data[hover].nom}</div>
                    <div className="text-slate-300">Prévu : <span className="font-bold text-white">{formatCHF(data[hover].ca_prevu)} CHF</span></div>
                    <div className="text-slate-300">Réel : <span className="font-bold text-white">{formatCHF(data[hover].ca_reel)} CHF</span></div>
                </div>
            )}
        </div>
    );
};

// --- Tendance mensuelle des heures — courbe + aire, interaction crosshair ---
const TrendLineChart: React.FC<{ data: MonthlyStats[]; dataKey: 'hours'; color: string; unit: string; height?: number }> =
    ({ data, dataKey, color, unit, height = 220 }) => {
        const containerRef = useRef<HTMLDivElement>(null);
        const [hoverIndex, setHoverIndex] = useState<number | null>(null);
        if (!data || data.length === 0) return <div className="text-sm text-slate-400 italic py-8 text-center">Pas encore de données.</div>;

        const values = data.map(d => d[dataKey]);
        const max = Math.max(...values, 1) * 1.15;
        const width = 1000, h = 400;
        const points = values.map((val, i) => ({
            x: data.length > 1 ? (i / (data.length - 1)) * width : width / 2,
            y: h - (val / max) * h, val,
        }));
        const pathD = `M ${points.map(p => `${p.x},${p.y}`).join(' L ')}`;
        const areaD = `${pathD} L ${width},${h} L 0,${h} Z`;

        const updateHover = (clientX: number) => {
            if (!containerRef.current) return;
            const rect = containerRef.current.getBoundingClientRect();
            const relX = (clientX - rect.left) / rect.width;
            setHoverIndex(Math.min(Math.max(Math.round(relX * (data.length - 1)), 0), data.length - 1));
        };
        const active = hoverIndex !== null ? points[hoverIndex] : null;

        return (
            <div
                ref={containerRef}
                className="w-full relative select-none cursor-crosshair touch-none"
                style={{ height }}
                onMouseMove={e => updateHover(e.clientX)}
                onMouseLeave={() => setHoverIndex(null)}
                onTouchMove={e => e.touches[0] && updateHover(e.touches[0].clientX)}
                onTouchStart={e => e.touches[0] && updateHover(e.touches[0].clientX)}
                onTouchEnd={() => setHoverIndex(null)}
            >
                <svg viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
                    <defs>
                        <linearGradient id={`grad-${dataKey}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={color} stopOpacity="0.1" />
                            <stop offset="100%" stopColor={color} stopOpacity="0" />
                        </linearGradient>
                    </defs>
                    <line x1="0" y1={h} x2={width} y2={h} stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                    <path d={areaD} fill={`url(#grad-${dataKey})`} stroke="none" />
                    <path d={pathD} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
                    {active && (
                        <g>
                            <line x1={active.x} y1={0} x2={active.x} y2={h} stroke={GRID} strokeWidth="1" vectorEffect="non-scaling-stroke" />
                            <circle cx={active.x} cy={active.y} r="5" fill={color} stroke="#fff" strokeWidth="2" vectorEffect="non-scaling-stroke" />
                        </g>
                    )}
                </svg>
                {active && hoverIndex !== null && containerRef.current && (
                    <div
                        className="absolute z-20 pointer-events-none bg-slate-900 text-white rounded-lg shadow-xl px-3 py-2 text-xs"
                        style={{
                            left: (active.x / width) * containerRef.current.getBoundingClientRect().width,
                            top: 0,
                            transform: `translate(${(active.x / width) > 0.6 ? '-105%' : '5%'}, 4px)`,
                        }}
                    >
                        <div className="text-slate-400 uppercase font-mono mb-0.5">{formatMonth(data[hoverIndex].month)}</div>
                        <div className="font-bold text-sm">{active.val.toLocaleString('fr-CH')} <span className="font-normal text-slate-400">{unit}</span></div>
                    </div>
                )}
            </div>
        );
    };

export const GlobalStats: React.FC = () => {
    const [activeTab, setActiveTab] = useState<StatsTab>('FINANCIER');
    const [stats, setStats] = useState<StatsData | null>(null);
    const [fin, setFin] = useState<FinancierStatsData | null>(null);
    const [filterRange, setFilterRange] = useState<'3M' | '6M' | '1Y' | 'ALL'>('1Y');

    useEffect(() => {
        api.get('/api/stats').then(async r => { if (r.ok) setStats(await r.json()); });
        api.get('/api/stats/financier').then(async r => { if (r.ok) setFin(await r.json()); });
    }, []);

    const filteredHistory = useMemo(() => {
        if (!stats?.history) return [];
        const n = stats.history.length;
        if (filterRange === '3M') return stats.history.slice(Math.max(n - 3, 0));
        if (filterRange === '6M') return stats.history.slice(Math.max(n - 6, 0));
        if (filterRange === '1Y') return stats.history.slice(Math.max(n - 12, 0));
        return stats.history;
    }, [stats, filterRange]);

    const totals = fin?.totals;
    const chantiers = fin?.chantiers ?? [];

    // Au-delà d'une dizaine de chantiers, une barre par chantier devient
    // illisible (et ça va monter à ~70) — on montre les 5 meilleures/moins
    // bonnes marges avec une échelle partagée, le détail complet reste dans
    // la table (avec recherche) plus bas.
    const splitMarge = chantiers.length > 10;
    const margeTop = splitMarge ? chantiers.slice(0, 5) : chantiers;
    const margeBottom = splitMarge ? chantiers.slice(-5) : [];
    const margeSharedMax = splitMarge ? Math.max(...[...margeTop, ...margeBottom].map(c => Math.abs(c.marge_reelle)), 1) : undefined;

    const [tableSearch, setTableSearch] = useState('');
    const filteredChantiers = tableSearch.trim()
        ? chantiers.filter(c => c.nom.toLowerCase().includes(tableSearch.trim().toLowerCase()))
        : chantiers;

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div>
                <h2 className="text-2xl sm:text-3xl font-bold text-slate-900">Statistiques</h2>
                <p className="text-slate-500 mt-1 text-sm">Vue d'ensemble opérationnelle et financière.</p>
            </div>

            <SlidingTabs
                tabs={[
                    { id: 'FINANCIER', label: 'Financier' },
                    { id: 'RH', label: 'RH & Planning' },
                ]}
                active={activeTab}
                onChange={setActiveTab}
            />

            {activeTab === 'RH' && <RhPlanningTab />}

            {activeTab === 'FINANCIER' && <>

            {/* ===== KPI ===== */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    label="Marge réelle totale"
                    value={totals ? `${formatCHF(totals.marge_reelle, true)} CHF` : '—'}
                    sub={totals ? `${formatPct(totals.pct_marge_reelle)} du CA facturé` : undefined}
                    delta={totals ? { value: `${totals.marge_reelle >= totals.marge_prevue ? '+' : ''}${formatCHF(totals.marge_reelle - totals.marge_prevue, true)} vs prévu`, good: totals.marge_reelle >= totals.marge_prevue } : undefined}
                />
                <StatTile
                    label="Avancement CA"
                    value={formatPct(totals?.pct_avancement_ca)}
                    sub={totals ? `${formatCHF(totals.ca_reel, true)} facturés / ${formatCHF(totals.ca_prevu, true)} prévus` : undefined}
                />
                <StatTile
                    label="Avancement débours sec"
                    value={formatPct(totals?.pct_avancement_debourse_sec)}
                    sub={totals ? `${formatCHF(totals.debourse_sec_reel, true)} / ${formatCHF(totals.debourse_sec_prevu, true)} prévus` : undefined}
                />
                <StatTile
                    label="Chantiers actifs"
                    value={stats?.active_chantiers ?? '—'}
                    sub={totals ? `${totals.chantiers_positive_marge} en marge positive · ${totals.chantiers_negative_marge} négative` : undefined}
                />
            </div>

            {/* ===== Avancement global ===== */}
            {totals && (
                <div className="card">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-5">Avancement global (réel / prévu, tous chantiers)</h3>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-6">
                        <AvancementDonut label="Chiffre d'affaires" pct={totals.pct_avancement_ca} />
                        <AvancementDonut label="Matériel" pct={totals.pct_avancement_materiel} />
                        <AvancementDonut label="Main d'œuvre" pct={totals.pct_avancement_mo} />
                        <AvancementDonut label="Débours sec" pct={totals.pct_avancement_debourse_sec} />
                    </div>
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-5 pt-4 border-t border-slate-100">
                        <LegendSwatch color={S_GOOD} label="< 90% — en cours" />
                        <LegendSwatch color={S_WARN} label="90-100% — proche du budget" />
                        <LegendSwatch color={S_CRIT} label="> 100% — dépassement" />
                    </div>
                </div>
            )}

            {/* ===== Marge par chantier ===== */}
            <div className="card">
                <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide mb-1">Marge réelle par chantier</h3>
                <p className="text-xs text-slate-400 mb-5">
                    {splitMarge
                        ? `5 meilleures et 5 moins bonnes marges sur ${chantiers.length} chantiers — détail complet et recherche dans la table plus bas.`
                        : 'Écart à zéro — chantiers en perte à gauche, en marge à droite.'}
                </p>
                {splitMarge ? (
                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-x-8 gap-y-6">
                        <div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Meilleures marges</div>
                            <MargeDivergingChart data={margeTop} maxAbsOverride={margeSharedMax} />
                        </div>
                        <div>
                            <div className="text-xs font-bold text-slate-500 uppercase tracking-wide mb-3">Marges les plus faibles</div>
                            <MargeDivergingChart data={margeBottom} maxAbsOverride={margeSharedMax} />
                        </div>
                    </div>
                ) : (
                    <MargeDivergingChart data={chantiers} />
                )}
            </div>

            {/* ===== CA prévu vs réel ===== */}
            {chantiers.length > 0 && (
                <div className="card">
                    <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Chiffre d'affaires — prévu vs réel</h3>
                        <div className="flex items-center gap-4">
                            <LegendSwatch color={D_POS} label="Au-dessus du prévu" />
                            <LegendSwatch color={D_NEG} label="En dessous du prévu" />
                        </div>
                    </div>
                    <p className="text-xs text-slate-400 mb-2">Un point par chantier — au-dessus de la diagonale, plus facturé que prévu.</p>
                    <CaScatterChart data={chantiers} />
                </div>
            )}

            {/* ===== Tendance mensuelle des heures ===== */}
            <div className="card">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
                    <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Heures travaillées</h3>
                    <div className="flex items-center gap-3">
                        {stats?.comparison && (
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${stats.comparison.hours_growth >= 0 ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                                {stats.comparison.hours_growth > 0 ? '+' : ''}{stats.comparison.hours_growth}% vs N-1
                            </span>
                        )}
                        <div className="flex p-1 bg-slate-100 rounded-lg overflow-hidden">
                            {(['3M', '6M', '1Y', 'ALL'] as const).map(range => (
                                <button key={range} onClick={() => setFilterRange(range)}
                                    className={`px-2.5 py-1 text-xs font-bold rounded-md transition-all ${filterRange === range ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-900'}`}>
                                    {range}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
                <p className="text-xs text-slate-400 mb-4">Total sur la période : {stats?.total_hours ?? '—'} h</p>
                <TrendLineChart data={filteredHistory} dataKey="hours" color="#eda100" unit="h" height={260} />
            </div>

            {/* ===== Table (repli accessible — toutes les valeurs, y compris celles poussées hors des barres/points) ===== */}
            {chantiers.length > 0 && (
                <div className="card p-0 overflow-x-auto">
                    <div className="flex items-center justify-between flex-wrap gap-3 px-6 pt-6 pb-4">
                        <h3 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Détail par chantier</h3>
                        {chantiers.length > 8 && (
                            <input
                                type="text" value={tableSearch} onChange={e => setTableSearch(e.target.value)}
                                placeholder="Rechercher un chantier…"
                                className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 focus:border-ohm-primary focus:outline-none w-48"
                            />
                        )}
                    </div>
                    <table className="w-full text-sm min-w-[720px]">
                        <thead className="bg-slate-50 text-slate-400 font-bold uppercase text-[11px] border-y border-slate-100">
                            <tr>
                                <th className="p-3 pl-6 text-left">Chantier</th>
                                <th className="p-3 text-right">CA prévu</th>
                                <th className="p-3 text-right">CA réel</th>
                                <th className="p-3 text-right">Marge prévue</th>
                                <th className="p-3 text-right">Marge réelle</th>
                                <th className="p-3 text-right">% marge</th>
                                <th className="p-3 pr-6 text-right">Avancement débours sec</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100 tabular-nums">
                            {filteredChantiers.map(c => (
                                <tr key={c.id} className="hover:bg-slate-50/70">
                                    <td className="p-3 pl-6 font-medium text-slate-700 whitespace-nowrap">{c.nom}</td>
                                    <td className="p-3 text-right text-slate-600">{formatCHF(c.ca_prevu)}</td>
                                    <td className="p-3 text-right text-slate-600">{formatCHF(c.ca_reel)}</td>
                                    <td className="p-3 text-right text-slate-600">{formatCHF(c.marge_prevue)}</td>
                                    <td className="p-3 text-right font-bold text-slate-900">{formatCHF(c.marge_reelle)}</td>
                                    <td className="p-3 text-right text-slate-600">{formatPct(c.pct_marge_reelle)}</td>
                                    <td className="p-3 pr-6 text-right font-bold text-slate-900">{formatPct(c.pct_avancement_debourse_sec)}</td>
                                </tr>
                            ))}
                            {filteredChantiers.length === 0 && (
                                <tr><td colSpan={7} className="p-6 text-center text-slate-400 italic">Aucun chantier ne correspond à la recherche.</td></tr>
                            )}
                        </tbody>
                    </table>
                </div>
            )}

            </>}
        </div>
    );
};
