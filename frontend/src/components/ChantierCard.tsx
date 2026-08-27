import { Chantier } from '../types';
import { StatusBadge } from './StatusBadge';
import { AlertTriangle, Clock } from 'lucide-react';

interface ChantierCardProps {
    chantier: Chantier;
    onClick: () => void;
}

export const ChantierCard = ({ chantier, onClick }: ChantierCardProps) => {
    const missing: string[] = [];
    if (!chantier.has_rapport) missing.push("rapport d'intervention");
    if (!chantier.has_mesure && !chantier.no_mesure_needed) missing.push('mesures');

    return (
        <div
            onClick={onClick}
            className="group relative glass-panel p-8 cursor-pointer hover-card overflow-hidden hover:bg-white/80 transition-all duration-500"
        >
            <div className="absolute top-0 right-0 p-6 z-10 flex items-center gap-2">
                {missing.length > 0 && (
                    /* This badge sits inline next to StatusBadge in a flex row —
                       not floating over a trigger icon — so it stays in normal
                       flow (position: static overrides .t-badge's own absolute
                       positioning) and only borrows the dot's pop-in animation. */
                    <div className="t-badge" data-open="true" style={{ position: 'static' }}>
                        <div
                            className="t-badge-dot w-7 h-7 rounded-full bg-red-600 text-white flex items-center justify-center shrink-0 shadow-[0_0_10px_rgba(220,38,38,0.6)] animate-pulse"
                            title={`Manque : ${missing.join(', ')}`}
                        >
                            <AlertTriangle size={14} />
                        </div>
                    </div>
                )}
                <StatusBadge status={chantier.status} type="chantier" />
            </div>

            {/* Neon Spotlight Effect (Simulated via CSS) */}
            <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
            <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500 group-hover:duration-200"></div>

            <div className="mb-6 relative z-10">
                <h3 className="text-2xl font-black font-display text-slate-900 uppercase tracking-tighter group-hover:text-primary transition-colors flex items-center gap-3 drop-shadow-md">
                    {chantier.nom}
                </h3>
                <p className="text-sm font-mono text-primary font-bold mt-2 opacity-80 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                    {chantier.annee}
                </p>
            </div>

            <div className="space-y-4 text-sm text-text-muted relative z-10">
                {chantier.address_work && (
                    <div className="flex items-start gap-3 group-hover:text-slate-900 transition-colors p-2 rounded-lg group-hover:bg-black/5">
                        <svg className="w-5 h-5 mt-0.5 shrink-0 text-primary/50 group-hover:text-primary transition-colors group-hover:drop-shadow-[0_0_5px_rgba(255,215,0,0.5)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        <span className="line-clamp-2 font-medium tracking-wide">{chantier.address_work}</span>
                    </div>
                )}
                {chantier.date_start && (
                    <div className="flex items-center gap-3 group-hover:text-slate-900 transition-colors p-2 rounded-lg group-hover:bg-black/5">
                        <svg className="w-5 h-5 shrink-0 text-primary/50 group-hover:text-primary transition-colors group-hover:drop-shadow-[0_0_5px_rgba(255,215,0,0.5)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <span className="font-mono text-xs">{chantier.date_start} {chantier.date_end ? `→ ${chantier.date_end}` : '...'}</span>
                    </div>
                )}

                {typeof chantier.hours_this_month === 'number' && chantier.hours_this_month > 0 && (
                    <div className="flex items-center gap-3 p-2 rounded-lg">
                        <Clock size={20} className="shrink-0 text-primary/50" />
                        <span className="font-mono text-xs">
                            <span className="font-bold text-slate-900">{chantier.hours_this_month} h</span> ce mois-ci
                        </span>
                    </div>
                )}

                {missing.length > 0 && (
                    <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-600 text-white shadow-[0_0_10px_rgba(220,38,38,0.4)]">
                        <AlertTriangle size={16} className="shrink-0" />
                        <span className="text-xs font-bold uppercase tracking-wide">Manque : {missing.join(' et ')}</span>
                    </div>
                )}
            </div>

            {/* Footer Removed as per user request */}
        </div>
    );
};
