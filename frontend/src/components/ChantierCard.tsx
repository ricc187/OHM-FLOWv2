import { Chantier } from '../types';
import { StatusBadge } from './StatusBadge';

interface ChantierCardProps {
    chantier: Chantier;
    onClick: () => void;
}

export const ChantierCard = ({ chantier, onClick }: ChantierCardProps) => {
    return (
        <div
            onClick={onClick}
            className="group relative bg-ohm-surface border border-slate-700 hover:border-ohm-primary rounded-2xl p-6 transition-all cursor-pointer hover:shadow-xl hover:translate-y-[-2px] overflow-hidden"
        >
            <div className="absolute top-0 right-0 p-4">
                <StatusBadge status={chantier.status} type="chantier" />
            </div>

            <div className="mb-4">
                <h3 className="text-xl font-black text-ohm-text-main uppercase tracking-tight group-hover:text-ohm-primary transition-colors">
                    {chantier.nom}
                </h3>
                <p className="text-xs font-mono text-ohm-text-muted mt-1">{chantier.annee}</p>
            </div>

            <div className="space-y-2 text-sm text-ohm-text-muted">
                {chantier.address_work && (
                    <div className="flex items-start gap-2">
                        <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                        <span className="line-clamp-2">{chantier.address_work}</span>
                    </div>
                )}
                {chantier.date_start && (
                    <div className="flex items-center gap-2">
                        <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                        <span>{chantier.date_start} {chantier.date_end ? `→ ${chantier.date_end}` : '...'}</span>
                    </div>
                )}
            </div>

            <div className="mt-6 flex items-center justify-between border-t border-slate-700 pt-4">
                <div className="flex -space-x-2">
                    {/* Placeholder for member avatars, showing count for now */}
                    <div className="w-8 h-8 rounded-full bg-slate-700 border-2 border-ohm-surface flex items-center justify-center text-[10px] font-bold text-white">
                        {chantier.members.length}
                    </div>
                    <span className="text-xs text-ohm-text-muted self-center ml-4">Membres</span>
                </div>
                <div className="text-ohm-primary">
                    <svg className="w-6 h-6 transform group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17 8l4 4m0 0l-4 4m4-4H3" /></svg>
                </div>
            </div>
        </div>
    );
};
