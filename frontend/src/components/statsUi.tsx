import React from 'react';

// Petits éléments partagés entre GlobalStats.tsx (Financier) et
// RhPlanningTab.tsx (RH & Planning) — extraits ici plutôt que dans l'un des
// deux fichiers pour éviter un import circulaire entre les deux (GlobalStats
// affiche RhPlanningTab dans son onglet RH).

// Diverging : polarité (marge positive/négative, planifié/réel au-dessus ou
// en-dessous) — même sens sur toute la page, financier comme RH.
export const D_POS = '#2a78d6';
export const D_NEG = '#e34948';
export const GRID = '#e2e8f0'; // slate-200

export const formatPct = (v: number | null | undefined) =>
    v == null ? '—' : `${(v * 100).toLocaleString('fr-CH', { maximumFractionDigits: 1 })}%`;

// --- Stat tile — label / value / delta, pas d'icône décorative (voir dataviz "figures") ---
export const StatTile: React.FC<{ label: string; value: React.ReactNode; sub?: string; delta?: { value: string; good: boolean } }> =
    ({ label, value, sub, delta }) => (
        <div className="card">
            <div className="text-xs font-bold text-slate-500 uppercase tracking-wider">{label}</div>
            <div className="mt-2 flex items-baseline gap-2 flex-wrap">
                <div className="text-3xl font-semibold text-slate-900">{value}</div>
                {delta && (
                    <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${delta.good ? 'text-green-700 bg-green-50' : 'text-red-700 bg-red-50'}`}>
                        {delta.value}
                    </span>
                )}
            </div>
            {sub && <div className="mt-1 text-xs text-slate-400">{sub}</div>}
        </div>
    );

export const LegendSwatch: React.FC<{ color: string; label: string }> = ({ color, label }) => (
    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-600">
        <span className="w-3 h-3 rounded-sm shrink-0" style={{ backgroundColor: color }} /> {label}
    </span>
);
