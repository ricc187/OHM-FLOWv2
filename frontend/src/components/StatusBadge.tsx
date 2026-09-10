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

    return (
        <span className={`px-2 py-0.5 rounded text-[10px] font-black uppercase tracking-wider ${colorClass}`}>
            {type === 'chantier' ? (CHANTIER_PHASE_LABELS[normalizedStatus] || status) : status}
        </span>
    );
};
