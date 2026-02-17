import React, { useEffect, useState, useRef, useMemo } from 'react';
import { Clock, DollarSign, FileText, Activity, TrendingUp } from 'lucide-react';

interface MonthlyStats {
    month: string;
    hours: number;
    material: number;
}

interface StatsData {
    total_entries: number;
    total_hours: number;
    total_material: number;
    active_chantiers: number;
    history: MonthlyStats[];
    comparison?: {
        hours_growth: number;
        material_growth: number;
        hours_curr: number;
        hours_last: number;
    };
}

// Helper Components
const StatCard = ({ icon: Icon, label, value, unit, color, bg, border }: any) => (
    <div className={`glass-panel p-6 ${border} transition-all group hover-card hover:-translate-y-1`}>
        <div className="flex items-center justify-between mb-4">
            <div className={`p-3 ${bg} rounded-xl ${color} shadow-lg shadow-black/20`}>
                <Icon size={24} />
            </div>
            <span className="text-xs font-bold text-gray-400 uppercase tracking-widest">{label}</span>
        </div>
        <div className="text-4xl font-display font-bold text-white">
            {value} <span className="text-sm font-bold text-gray-500">{unit}</span>
        </div>
    </div>
);

const formatMonth = (ym: string) => {
    if (!ym) return '';
    const [y, m] = ym.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1);
    return date.toLocaleString('fr-FR', { month: 'short' }).replace('.', '');
};

// Interactive SVG Line Chart
const InteractiveLineChart = ({ data, dataKey, color, height = 250, unit = '' }: any) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const [hoverIndex, setHoverIndex] = useState<number | null>(null);
    const [hoverPos, setHoverPos] = useState<{ x: number, y: number } | null>(null);

    if (!data || data.length === 0) return null;

    const values = data.map((d: any) => d[dataKey]);
    const max = Math.max(...values, 1) * 1.1; // Add 10% headroom
    const min = 0;

    // SVG Dimensions (Virtual)
    const width = 1000;
    const h = 500;

    // Calculate points
    const points = values.map((val: number, i: number) => {
        const x = (i / (values.length - 1)) * width;
        const y = h - ((val - min) / (max - min)) * h;
        return { x, y, val, original: data[i] };
    });

    // Create Path command (Smooth curve using Catmull-Rom or similar simple smoothing could be better, but polyline for now is safer for exactness)
    // Let's stick to polyline for accuracy but maybe slightly smoothed if we had a library. 
    // Manual smooth path:
    const pathD = `M ${points.map((p: any) => `${p.x},${p.y}`).join(' L ')}`;
    const areaPathD = `${pathD} L ${width},${h} L 0,${h} Z`;

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!containerRef.current) return;
        const rect = containerRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left;
        const relativeX = x / rect.width; // 0 to 1

        // Find closest point
        const index = Math.min(Math.max(Math.round(relativeX * (data.length - 1)), 0), data.length - 1);

        setHoverIndex(index);
        // Calculate tooltip position based on the data point
        const p = points[index];
        // Scale back to container pixels
        setHoverPos({
            x: (p.x / width) * rect.width,
            y: (p.y / h) * rect.height
        });
    };

    const handleMouseLeave = () => {
        setHoverIndex(null);
        setHoverPos(null);
    };

    const activePoint = hoverIndex !== null ? points[hoverIndex] : null;

    return (
        <div
            ref={containerRef}
            className="w-full relative select-none cursor-crosshair touch-none"
            style={{ height: `${height}px` }}
            onMouseMove={handleMouseMove}
            onMouseLeave={handleMouseLeave}
        >
            <svg viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
                <defs>
                    <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.4" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>

                {/* Grid Lines (Optional) */}
                <line x1="0" y1={h} x2={width} y2={h} stroke="rgba(255,255,255,0.1)" strokeWidth="2" />
                <line x1="0" y1={0} x2={width} y2={0} stroke="rgba(255,255,255,0.1)" strokeWidth="2" />

                <path d={areaPathD} fill={`url(#grad-${color.replace('#', '')})`} stroke="none" />
                <path d={pathD} fill="none" stroke={color} strokeWidth="4" strokeLinecap="round" strokeLinejoin="round" vectorEffect="non-scaling-stroke" />

                {/* Active Point Highlight */}
                {activePoint && (
                    <g>
                        <line
                            x1={activePoint.x} y1={0}
                            x2={activePoint.x} y2={h}
                            stroke="rgba(255,255,255,0.2)"
                            strokeWidth="2"
                            strokeDasharray="10,10"
                            vectorEffect="non-scaling-stroke"
                        />
                        <circle
                            cx={activePoint.x} cy={activePoint.y}
                            r="6"
                            fill={color}
                            stroke="white"
                            strokeWidth="2"
                            vectorEffect="non-scaling-stroke"
                        />
                    </g>
                )}
            </svg>

            {/* Floating Tooltip */}
            {hoverIndex !== null && hoverPos && activePoint && (
                <div
                    className="absolute z-20 pointer-events-none transition-all duration-75 ease-out"
                    style={{
                        left: hoverPos.x,
                        top: 0,
                        transform: `translate(${hoverPos.x > containerRef.current!.getBoundingClientRect().width / 2 ? '-100%' : '0%'}, -120%)`
                    }}
                >
                    <div className="bg-slate-900/90 backdrop-blur border border-white/10 p-3 rounded-xl shadow-2xl min-w-[120px] ml-4 mt-4">
                        <div className="text-gray-400 text-xs font-mono uppercase mb-1">{formatMonth(activePoint.original.month)}</div>
                        <div className="text-white font-bold text-xl flex items-baseline gap-1">
                            {activePoint.val}
                            <span className="text-sm font-normal text-gray-500">{unit}</span>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export const GlobalStats: React.FC = () => {
    const [stats, setStats] = useState<StatsData>({
        total_entries: 0,
        total_hours: 0,
        total_material: 0,
        active_chantiers: 0,
        history: []
    });

    const [filterRange, setFilterRange] = useState<'3M' | '6M' | '1Y' | 'ALL'>('1Y');

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch('/api/stats', { headers: { 'Authorization': `Bearer ${localStorage.getItem('ohm_token')}` } });
                if (res.ok) {
                    setStats(await res.json());
                }
            } catch (error) {
                console.error("Failed to fetch stats", error);
            }
        };
        fetchStats();
    }, []);

    // Filter Logic
    const filteredHistory = useMemo(() => {
        if (!stats.history) return [];
        const count = stats.history.length;
        if (filterRange === '3M') return stats.history.slice(Math.max(count - 3, 0));
        if (filterRange === '6M') return stats.history.slice(Math.max(count - 6, 0));
        if (filterRange === '1Y') return stats.history.slice(Math.max(count - 12, 0)); // Actually all recent 12 provided by backend usually
        return stats.history;
    }, [stats.history, filterRange]);

    const maxMaterial = Math.max(...filteredHistory.map(h => h.material), 1);

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div className="flex flex-col md:flex-row md:items-end justify-between gap-4">
                <div>
                    <h2 className="text-4xl font-display font-bold text-white flex items-center gap-3">
                        <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-glow">
                            <Activity className="text-blue-400" size={32} />
                        </div>
                        <span className="text-gradient">Statistiques</span>
                    </h2>
                    <p className="text-text-muted mt-2 text-lg">Vue d'ensemble et analytique de performance.</p>
                </div>

                {/* Date Controls */}
                <div className="flex p-1 bg-black/40 backdrop-blur border border-white/10 rounded-xl overflow-hidden self-start md:self-auto">
                    {(['3M', '6M', '1Y', 'ALL'] as const).map(range => (
                        <button
                            key={range}
                            onClick={() => setFilterRange(range)}
                            className={`px-4 py-2 text-xs font-bold transition-all ${filterRange === range
                                ? 'bg-primary text-black shadow-lg'
                                : 'text-gray-400 hover:text-white hover:bg-white/5'
                                }`}
                        >
                            {range}
                        </button>
                    ))}
                </div>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    icon={Clock}
                    label="Total Heures"
                    value={stats.total_hours}
                    unit="h"
                    color="text-primary"
                    bg="bg-primary/10"
                    border="hover:border-primary/50"
                />
                <StatCard
                    icon={DollarSign}
                    label="Total Dépenses"
                    value={stats.total_material.toLocaleString('fr-CH', { minimumFractionDigits: 2 })}
                    unit="CHF"
                    color="text-blue-400"
                    bg="bg-blue-500/10"
                    border="hover:border-blue-500/50"
                />
                <StatCard
                    icon={FileText}
                    label="Nombre de Saisies"
                    value={stats.total_entries}
                    color="text-purple-400"
                    bg="bg-purple-500/10"
                    border="hover:border-purple-500/50"
                />
                <StatCard
                    icon={Activity}
                    label="Chantiers Actifs"
                    value={stats.active_chantiers}
                    color="text-green-400"
                    bg="bg-green-500/10"
                    border="hover:border-green-500/50"
                />
            </div>

            {/* Charts Grid */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-8">

                {/* Hours Trend (Curve) */}
                <div className="glass-panel p-6 relative overflow-hidden group flex flex-col">
                    <div className="flex items-center justify-between mb-8 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <TrendingUp className="text-primary" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Tendance des Heures</h3>
                                <p className="text-xs text-gray-500">Période: {filterRange}</p>
                            </div>
                        </div>
                        {stats.comparison && (
                            <div className={`px-3 py-1 rounded-full text-xs font-bold border ${stats.comparison.hours_growth >= 0 ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                {stats.comparison.hours_growth > 0 ? '+' : ''}{stats.comparison.hours_growth}% vs N-1
                            </div>
                        )}
                    </div>

                    <div className="flex-1 min-h-[250px] w-full relative">
                        <InteractiveLineChart data={filteredHistory} dataKey="hours" color="#FFD700" height={250} unit="h" />
                    </div>

                    {/* X-Axis Labels */}
                    <div className="flex justify-between mt-4 text-[10px] text-gray-500 font-mono uppercase tracking-widest px-2">
                        {filteredHistory.length > 0 && (
                            <>
                                <span>{formatMonth(filteredHistory[0].month)}</span>
                                <span className="hidden sm:inline">{formatMonth(filteredHistory[Math.floor(filteredHistory.length / 2)].month)}</span>
                                <span>{formatMonth(filteredHistory[filteredHistory.length - 1].month)}</span>
                            </>
                        )}
                    </div>
                </div>

                {/* Expenses Trend (Bar) */}
                <div className="glass-panel p-6 relative overflow-hidden flex flex-col">
                    <div className="flex items-center justify-between mb-8 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg">
                                <DollarSign className="text-blue-400" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Dépenses Matériel</h3>
                                <p className="text-xs text-gray-500">Période: {filterRange}</p>
                            </div>
                        </div>
                        {stats.comparison && stats.comparison.material_growth !== undefined && (
                            <div className={`px-3 py-1 rounded-full text-xs font-bold border ${stats.comparison.material_growth >= 0 ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                {stats.comparison.material_growth > 0 ? '+' : ''}{stats.comparison.material_growth}% vs N-1
                            </div>
                        )}
                    </div>

                    <div className="h-[250px] flex items-end justify-between gap-2 mt-4">
                        {filteredHistory.map((item, index) => (
                            <div key={index} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end relative">
                                <div
                                    className="w-full bg-gradient-to-t from-blue-500/10 to-blue-500/40 border-t-2 border-blue-500 rounded-t-[2px] transition-all duration-300 group-hover:from-blue-500/30 group-hover:to-blue-500/60 relative"
                                    style={{ height: `${Math.max((item.material / maxMaterial) * 100, 2)}%` }}
                                >
                                    {/* Tooltip for Bar Chart */}
                                    <div className="opacity-0 group-hover:opacity-100 absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs whitespace-nowrap z-20 pointer-events-none transition-all">
                                        <div className="font-bold text-white">{item.material.toLocaleString()} CHF</div>
                                        <div className="text-gray-400">{formatMonth(item.month)}</div>
                                    </div>
                                </div>
                                <span className="text-[9px] font-mono text-gray-500 uppercase rotate-45 md:rotate-0 mt-2 truncate w-full text-center">
                                    {filteredHistory.length > 6 ? (index % 2 === 0 ? formatMonth(item.month) : '') : formatMonth(item.month)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};
