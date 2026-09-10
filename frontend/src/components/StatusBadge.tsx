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

    // Deux familles de sens partagées par tous les types ci-dessous : "en
    // attente" (ambre) et "terminé/validé/approuvé" (status-done, seul token
    // vert du design system — on l'utilise pour le fond ET le texte au lieu
    // de mélanger token + couleur brute selon le fichier, cf. impeccable
    // polish : chantier/entry/leave/prevision avaient chacun leur propre
    // vert et leur propre ambre non coordonnés).
    const PENDING = 'bg-amber-500/20 text-amber-600 border border-amber-500/30';
    const DONE = 'bg-status-done/20 text-status-done border border-status-done/30';

    if (type === 'chantier') {
        if (normalizedStatus === 'NON_PLANIFIE') colorClass = 'bg-slate-200/60 text-slate-500 border border-slate-300/50';
        if (normalizedStatus === 'EN_COURS') colorClass = 'bg-status-active/20 text-status-active border border-status-active/30';
        if (normalizedStatus === 'TERMINE') colorClass = DONE;
    }

    if (type === 'entry') {
        if (normalizedStatus === 'PENDING') colorClass = PENDING;
        if (normalizedStatus === 'VALIDATED') colorClass = DONE;
    }

    if (type === 'leave') {
        if (normalizedStatus === 'PENDING') colorClass = PENDING;
        if (normalizedStatus === 'APPROVED') colorClass = DONE;
        if (normalizedStatus === 'REJECTED') colorClass = 'bg-red-500/20 text-red-400 border border-red-500/30';
    }

    if (type === 'prevision') {
        if (normalizedStatus === 'PREVU') colorClass = PENDING;
        if (normalizedStatus === 'CONFIRME') colorClass = DONE;
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
