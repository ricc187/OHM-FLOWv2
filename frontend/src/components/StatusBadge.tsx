import { useEffect, useRef, useState } from 'react';

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

function resolve(status: string, type: StatusBadgeProps['type']) {
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

    const label = type === 'chantier' ? (CHANTIER_PHASE_LABELS[normalizedStatus] || status) : status;
    return { label, colorClass };
}

// transitions-dev "04-text-states-swap" — reused across most list views
// (ChantierCard, entries, leave requests, previsions), so a status change
// (e.g. PENDING -> VALIDATED, or a leave getting approved) reads as a real
// transition instead of the label/color just snapping.
export const StatusBadge = ({ status, type }: StatusBadgeProps) => {
    const next = resolve(status, type);
    const [displayed, setDisplayed] = useState(next);
    const [phase, setPhase] = useState<'idle' | 'exit' | 'enter-start'>('idle');
    const isFirstRender = useRef(true);

    useEffect(() => {
        if (isFirstRender.current) {
            isFirstRender.current = false;
            setDisplayed(next);
            return;
        }
        if (next.label === displayed.label && next.colorClass === displayed.colorClass) return;

        setPhase('exit');
        const exitTimer = setTimeout(() => {
            setDisplayed(next);
            setPhase('enter-start');
            const raf = requestAnimationFrame(() => setPhase('idle'));
            return () => cancelAnimationFrame(raf);
        }, 150); // matches --text-swap-dur
        return () => clearTimeout(exitTimer);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [next.label, next.colorClass]);

    return (
        <span
            className={`t-text-swap ${phase === 'exit' ? 'is-exit' : phase === 'enter-start' ? 'is-enter-start' : ''} px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${displayed.colorClass}`}
        >
            {displayed.label}
        </span>
    );
};
