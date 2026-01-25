
interface StatusBadgeProps {
    status: string;
    type: 'chantier' | 'entry' | 'leave';
}

export const StatusBadge = ({ status, type }: StatusBadgeProps) => {
    let colorClass = 'bg-slate-700 text-slate-300'; // Default

    const normalizedStatus = status.toUpperCase();

    if (type === 'chantier') {
        if (normalizedStatus === 'FUTURE') colorClass = 'bg-status-future/20 text-status-future border border-status-future/30';
        if (normalizedStatus === 'ACTIVE') colorClass = 'bg-status-active/20 text-status-active border border-status-active/30';
        if (normalizedStatus === 'DONE') colorClass = 'bg-status-done/40 text-emerald-300 border border-status-done/50';
    }

    if (type === 'entry') {
        if (normalizedStatus === 'PENDING') colorClass = 'bg-orange-500/20 text-orange-400 border border-orange-500/30';
        if (normalizedStatus === 'VALIDATED') colorClass = 'bg-green-500/20 text-green-400 border border-green-500/30';
    }

    if (type === 'leave') {
        if (normalizedStatus === 'PENDING') colorClass = 'bg-yellow-500/20 text-yellow-400';
        if (normalizedStatus === 'APPROVED') colorClass = 'bg-green-500/20 text-green-400';
        if (normalizedStatus === 'REJECTED') colorClass = 'bg-red-500/20 text-red-400';
    }

    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${colorClass}`}>
            {status}
        </span>
    );
};
