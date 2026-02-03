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
}

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

    const maxHours = Math.max(...stats.history.map(h => h.hours), 1);
    const maxMaterial = Math.max(...stats.history.map(h => h.material), 1);

    return (
        <div className="space-y-8 animate-fade-in pb-10">
            <div>
                <h2 className="text-3xl font-black text-white uppercase tracking-tighter">Statistiques Admin</h2>
                <p className="text-gray-400 mt-2">Vue d'ensemble et historique de l'activité.</p>
            </div>

            {/* KPI Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
                <StatCard
                    icon={Clock}
                    label="Total Heures"
                    value={stats.total_hours}
                    unit="h"
                    color="text-ohm-primary"
                    bg="bg-ohm-primary/10"
                    border="hover:border-ohm-primary/50"
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

            {/* Charts Section */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mt-12">

                {/* Hours Chart */}
                <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-8">
                        <TrendingUp className="text-ohm-primary" size={20} />
                        <h3 className="text-xl font-bold text-white">Évolution des Heures</h3>
                    </div>
                    <div className="h-64 flex items-end justify-between gap-4">
                        {stats.history.map((item, index) => (
                            <div key={index} className="flex-1 flex flex-col items-center gap-2 group hover:z-50 h-full justify-end relative">
                                <div
                                    className="w-full max-w-[3rem] bg-ohm-primary/20 border-t-4 border-ohm-primary rounded-t-sm transition-all duration-500 group-hover:bg-ohm-primary/40 relative min-h-[4px]"
                                    style={{ height: `${Math.max((item.hours / maxHours) * 100, 2)}%` }}
                                >
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-bold text-white shadow-xl opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 whitespace-nowrap pointer-events-none z-50">
                                        {item.hours} h
                                    </div>
                                </div>
                                <span className="text-xs font-mono text-gray-500 uppercase">{formatMonth(item.month)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* Expenses Chart */}
                <div className="bg-slate-800/50 p-8 rounded-2xl border border-slate-700">
                    <div className="flex items-center gap-3 mb-8">
                        <TrendingUp className="text-blue-400" size={20} />
                        <h3 className="text-xl font-bold text-white">Évolution des Dépenses</h3>
                    </div>
                    <div className="h-64 flex items-end justify-between gap-4">
                        {stats.history.map((item, index) => (
                            <div key={index} className="flex-1 flex flex-col items-center gap-2 group hover:z-50 h-full justify-end relative">
                                <div
                                    className="w-full max-w-[3rem] bg-blue-500/20 border-t-4 border-blue-500 rounded-t-sm transition-all duration-500 group-hover:bg-blue-500/40 relative min-h-[4px]"
                                    style={{ height: `${Math.max((item.material / maxMaterial) * 100, 2)}%` }}
                                >
                                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 bg-slate-900 border border-slate-700 px-3 py-2 rounded-lg text-sm font-bold text-white shadow-xl opacity-0 group-hover:opacity-100 transition-all scale-95 group-hover:scale-100 whitespace-nowrap pointer-events-none z-50">
                                        {item.material} CHF
                                    </div>
                                </div>
                                <span className="text-xs font-mono text-gray-500 uppercase">{formatMonth(item.month)}</span>
                            </div>
                        ))}
                    </div>
                </div>

            </div>
        </div>
    );
};

// Helper Components
const StatCard = ({ icon: Icon, label, value, unit, color, bg, border }: any) => (
    <div className={`bg-slate-800/50 p-6 rounded-2xl border border-slate-700 ${border} transition-all group hover:-translate-y-1 hover:shadow-xl`}>
        <div className="flex items-center justify-between mb-4">
            <div className={`p-3 ${bg} rounded-xl ${color}`}>
                <Icon size={24} />
            </div>
            <span className="text-xs font-bold text-gray-500 uppercase">{label}</span>
        </div>
        <div className="text-4xl font-black text-white">
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
