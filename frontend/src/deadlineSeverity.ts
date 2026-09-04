import { Chantier } from './types';
import { chantierPhase } from './chantierPhase';

// Calcul partagé entre ChantierCard (code couleur) et ChantierDetail (aperçu
// INFO) — une seule source de vérité pour les seuils et les libellés.
export type DeadlineSeverity = 'none' | 'warning' | 'alert' | 'urgent' | 'overdue';

// Seuils en jours restants — ajustables ici sans toucher au JSX des
// composants qui les consomment.
export const DEADLINE_THRESHOLDS = {
    WARNING_DAYS: 14, // <= 14j et > 7j -> jaune
    ALERT_DAYS: 7,    // <= 7j et > 3j -> orange
    URGENT_DAYS: 3,   // <= 3j et >= 0j -> rouge
};

export const daysUntilDeadline = (deadline: string): number => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const target = new Date(deadline + 'T00:00:00');
    return Math.round((target.getTime() - today.getTime()) / 86400000);
};

// Un chantier Terminé n'a plus d'urgence de deadline à signaler — sinon un
// chantier fini après sa deadline resterait affiché "dépassée" pour
// toujours, un faux signal une fois le travail réellement achevé.
export const deadlineSeverity = (c: Chantier): DeadlineSeverity => {
    if (!c.deadline || chantierPhase(c) === 'TERMINE') return 'none';
    const days = daysUntilDeadline(c.deadline);
    if (days < 0) return 'overdue';
    if (days <= DEADLINE_THRESHOLDS.URGENT_DAYS) return 'urgent';
    if (days <= DEADLINE_THRESHOLDS.ALERT_DAYS) return 'alert';
    if (days <= DEADLINE_THRESHOLDS.WARNING_DAYS) return 'warning';
    return 'none';
};

// Couleur de texte partagée par ChantierCard et ChantierDetail (INFO) — même
// échelle que le fond/liseré de la carte, juste appliquée au texte plutôt
// qu'au fond quand il n'y a pas de fond dédié à teinter.
export const DEADLINE_TEXT_CLASSES: Record<DeadlineSeverity, string> = {
    none: 'text-text-muted',
    warning: 'text-amber-700',
    alert: 'text-orange-700',
    urgent: 'text-red-700',
    overdue: 'text-red-800',
};

// Classes appliquées sur toute une carte selon la sévérité — partagées par
// ChantierCard (sévérité = deadline) et PotAChantier (sévérité = jours sans
// planification) : même échelle de couleur, deux métriques différentes.
// Fonds pleins (pas de /NN translucide) et liserés épais dès "warning" pour
// que chaque palier se voie clairement d'un coup d'œil sur la grille, pas
// juste au survol rapproché. "overdue" pousse encore plus loin (ring plus
// épais, rouge plus sombre).
export const CARD_SEVERITY_CLASSES: Record<DeadlineSeverity, string> = {
    none: '',
    warning: 'ring-2 ring-inset ring-amber-400 border-l-[6px] border-l-amber-500 bg-amber-100',
    alert: 'ring-2 ring-inset ring-orange-500 border-l-[6px] border-l-orange-600 bg-orange-100',
    urgent: 'ring-2 ring-inset ring-red-500 border-l-[6px] border-l-red-600 bg-red-100',
    overdue: 'ring-[3px] ring-inset ring-red-700 border-l-[8px] border-l-red-800 bg-red-200',
};

export const BADGE_SEVERITY_CLASSES: Record<Exclude<DeadlineSeverity, 'none'>, string> = {
    warning: 'bg-amber-400 text-black',
    alert: 'bg-orange-500 text-white',
    urgent: 'bg-red-500 text-white',
    overdue: 'bg-red-700 text-white',
};

export const deadlineDaysLabel = (deadline: string): string => {
    const days = daysUntilDeadline(deadline);
    if (days < 0) return `Dépassée depuis ${Math.abs(days)} j`;
    if (days === 0) return "Aujourd'hui";
    if (days === 1) return 'Demain';
    return `Dans ${days} j`;
};
