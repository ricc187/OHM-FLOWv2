import React, { useEffect, useState } from 'react';
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
    // YYYY-MM -> MMM
    const [y, m] = ym.split('-');
    const date = new Date(parseInt(y), parseInt(m) - 1);
    return date.toLocaleString('fr-FR', { month: 'short' }).replace('.', '');
};

// SVG Line Chart Component
const SimpleLineChart = ({ data, dataKey, color, height = 200 }: any) => {
    if (!data || data.length === 0) return null;

    const values = data.map((d: any) => d[dataKey]);
    const max = Math.max(...values, 1);
    const min = 0;

    // SVG Dimensions
    const width = 100; // viewbox units
    const h = 50; // viewbox units

    // Calculate points
    const points = values.map((val: number, i: number) => {
        const x = (i / (values.length - 1)) * width;
        const y = h - ((val - min) / (max - min)) * h;
        return `${x},${y}`;
    });

    // Create Path command (Simple polyline)
    const pathD = `M ${points.join(' L ')}`;

    // Area Path
    const areaPathD = `${pathD} L ${width},${h} L 0,${h} Z`;

    return (
        <div className="w-full h-full relative" style={{ height: `${height}px` }}>
            <svg viewBox={`0 0 ${width} ${h}`} preserveAspectRatio="none" className="w-full h-full overflow-visible">
                <defs>
                    <linearGradient id={`grad-${color.replace('#', '')}`} x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={color} stopOpacity="0.3" />
                        <stop offset="100%" stopColor={color} stopOpacity="0" />
                    </linearGradient>
                </defs>
                <path d={areaPathD} fill={`url(#grad-${color.replace('#', '')})`} stroke="none" />
                <path d={pathD} fill="none" stroke={color} strokeWidth="0.5" strokeLinecap="round" vectorEffect="non-scaling-stroke" />
                {points.map((p: string, i: number) => {
                    const [cx, cy] = p.split(',');
                    return (
                        <circle key={i} cx={cx} cy={cy} r="1.5" fill="white" stroke={color} strokeWidth="0.5" className="opacity-0 hover:opacity-100 transition-opacity" />
                    );
                })}
            </svg>
            <div className="absolute inset-0 flex items-end justify-between pointer-events-none">
                {data.map((d: any, i: number) => (
                    <div key={i} className="group relative h-full flex items-end justify-center w-full pointer-events-auto">
                        <div className="opacity-0 group-hover:opacity-100 absolute bottom-full mb-2 bg-slate-900 border border-slate-700 p-2 rounded shadow-xl text-xs whitespace-nowrap z-10 transition-all">
                            <div className="font-bold text-white">{d[dataKey]}</div>
                            <div className="text-gray-400">{formatMonth(d.month)}</div>
                        </div>
                    </div>
                ))}
            </div>
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

    useEffect(() => {
        const fetchStats = async () => {
            try {
                const res = await fetch('/api/stats');
                if (res.ok) {
                    setStats(await res.json());
                }
            } catch (error) {
                console.error("Failed to fetch stats", error);
            }
        };
        fetchStats();
    }, []);

    const maxMaterial = Math.max(...stats.history.map(h => h.material), 1);

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div>
                <h2 className="text-4xl font-display font-bold text-white flex items-center gap-3">
                    <div className="p-3 bg-blue-500/10 rounded-2xl border border-blue-500/20 shadow-glow">
                        <Activity className="text-blue-400" size={32} />
                    </div>
                    <span className="text-gradient">Statistiques</span>
                </h2>
                <p className="text-text-muted mt-2 text-lg">Vue d'ensemble et analytique de performance.</p>
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
                <div className="glass-panel p-6 relative overflow-hidden group">
                    <div className="flex items-center justify-between mb-8 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-primary/10 rounded-lg">
                                <TrendingUp className="text-primary" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Tendance des Heures</h3>
                                <p className="text-xs text-gray-500">12 derniers mois</p>
                            </div>
                        </div>
                        {stats.comparison && (
                            <div className={`px-3 py-1 rounded-full text-xs font-bold border ${stats.comparison.hours_growth >= 0 ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                {stats.comparison.hours_growth > 0 ? '+' : ''}{stats.comparison.hours_growth}% vs N-1
                            </div>
                        )}
                    </div>

                    <div className="mt-4">
                        <SimpleLineChart data={stats.history} dataKey="hours" color="#FFD700" height={250} />
                    </div>

                    {/* X-Axis Labels */}
                    <div className="flex justify-between mt-4 text-[10px] text-gray-500 font-mono uppercase tracking-widest px-2">
                        {stats.history.filter((_, i) => i % 2 === 0).map((d, i) => (
                            <span key={i}>{formatMonth(d.month)}</span>
                        ))}
                    </div>
                </div>

                {/* Expenses Trend (Bar) */}
                <div className="glass-panel p-6 relative overflow-hidden">
                    <div className="flex items-center justify-between mb-8 relative z-10">
                        <div className="flex items-center gap-3">
                            <div className="p-2 bg-blue-500/10 rounded-lg">
                                <DollarSign className="text-blue-400" size={20} />
                            </div>
                            <div>
                                <h3 className="text-lg font-bold text-white">Dépenses Matériel</h3>
                                <p className="text-xs text-gray-500">12 derniers mois</p>
                            </div>
                        </div>
                        {stats.comparison && (
                            <div className={`px-3 py-1 rounded-full text-xs font-bold border ${stats.comparison.material_growth >= 0 ? 'bg-green-500/20 text-green-400 border-green-500/30' : 'bg-red-500/20 text-red-400 border-red-500/30'}`}>
                                {stats.comparison.material_growth > 0 ? '+' : ''}{stats.comparison.material_growth}% vs N-1
                            </div>
                        )}
                    </div>

                    <div className="h-[250px] flex items-end justify-between gap-2 mt-4">
                        {stats.history.map((item, index) => (
                            <div key={index} className="flex-1 flex flex-col items-center gap-2 group h-full justify-end relative">
                                <div
                                    className="w-full bg-gradient-to-t from-blue-500/10 to-blue-500/40 border-t-2 border-blue-500 rounded-t-[2px] transition-all duration-300 group-hover:from-blue-500/30 group-hover:to-blue-500/60"
                                    style={{ height: `${Math.max((item.material / maxMaterial) * 100, 2)}%` }}
                                >
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 px-2 py-1 rounded text-[10px] font-bold text-white opacity-0 group-hover:opacity-100 transition-all pointer-events-none whitespace-nowrap z-20">
                                        {item.material}.-
                                    </div>
                                </div>
                                <span className="text-[9px] font-mono text-gray-500 uppercase rotate-45 md:rotate-0 mt-2 truncate w-full text-center">{formatMonth(item.month)}</span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};
