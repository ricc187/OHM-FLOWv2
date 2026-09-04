import { Chantier } from './types';

// Le statut brut FUTURE/ACTIVE du backend n'a plus de sens produit — 3 états
// dérivés remplacent la notion de statut manuel : DONE reste explicite
// (bouton Clôturer/Ré-ouvrir, ChantierDetail), le reste se déduit de
// has_assignments (voir "Pot à chantier"). Utilisé par Dashboard (filtre),
// ChantierCard et ChantierDetail (badge) — une seule source de vérité.
export type ChantierPhase = 'NON_PLANIFIE' | 'EN_COURS' | 'TERMINE';

export const chantierPhase = (c: Chantier): ChantierPhase => {
    if (c.status === 'DONE') return 'TERMINE';
    return c.has_assignments ? 'EN_COURS' : 'NON_PLANIFIE';
};

export const CHANTIER_PHASE_LABELS: Record<ChantierPhase, string> = {
    NON_PLANIFIE: 'Non planifié',
    EN_COURS: 'En cours',
    TERMINE: 'Terminé',
};
