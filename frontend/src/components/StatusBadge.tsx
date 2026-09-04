
interface StatusBadgeProps {
    status: string;
    type: 'chantier' | 'entry' | 'leave' | 'prevision';
}

// Callers pass a ChantierPhase key ('NON_PLANIFIE' | 'EN_COURS' | 'TERMINE',
// see chantierPhase.ts) for type='chantier' — this maps it to both the
// display label and the color, one source of truth for the 3 states.
const CHANTIER_PHASE_LABELS: Record<string, string> = {
    NON_PLANIFIE: 'Non planifié',
    EN_COURS: 'En cours',
    TERMINE: 'Terminé',
};

export const StatusBadge = ({ status, type }: StatusBadgeProps) => {
    let colorClass = 'bg-slate-100 text-slate-300'; // Default

    const normalizedStatus = status.toUpperCase();

    if (type === 'chantier') {
        if (normalizedStatus === 'NON_PLANIFIE') colorClass = 'bg-slate-200/60 text-slate-500 border border-slate-300/50';
        if (normalizedStatus === 'EN_COURS') colorClass = 'bg-status-active/20 text-status-active border border-status-active/30';
        if (normalizedStatus === 'TERMINE') colorClass = 'bg-status-done/40 text-emerald-300 border border-status-done/50';
    }

    if (type === 'entry') {
        if (normalizedStatus === 'PENDING') colorClass = 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
        if (normalizedStatus === 'VALIDATED') colorClass = 'bg-green-500/20 text-green-400 border border-green-500/30';
    }

    if (type === 'leave') {
        if (normalizedStatus === 'PENDING') colorClass = 'bg-yellow-500/20 text-blue-600';
        if (normalizedStatus === 'APPROVED') colorClass = 'bg-green-500/20 text-green-400';
        if (normalizedStatus === 'REJECTED') colorClass = 'bg-red-500/20 text-red-400';
    }

    if (type === 'prevision') {
        if (normalizedStatus === 'PREVU') colorClass = 'bg-amber-500/20 text-amber-600 border border-amber-500/30';
        if (normalizedStatus === 'CONFIRME') colorClass = 'bg-emerald-500/20 text-emerald-600 border border-emerald-500/30';
    }

    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${colorClass}`}>
            {type === 'chantier' ? (CHANTIER_PHASE_LABELS[normalizedStatus] || status) : status}
        </span>
    );
};
