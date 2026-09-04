import { LeaveType } from './types';

// Mirrors backend app.py's LEAVE_TYPES/LEAVE_TYPE_LABELS — keep both in sync
// if a label changes. Shared between Planning.tsx (legacy leave form) and
// Agenda's entry form so the list only lives in one place.
export const LEAVE_TYPE_OPTIONS: { value: LeaveType; label: string }[] = [
    { value: 'CONGE', label: 'Congé' },
    { value: 'MALADIE', label: 'Maladie' },
    { value: 'ABSENCE', label: 'Absence' },
    { value: 'ARMEE', label: 'Armée' },
    { value: 'CONGE_PAT_MAT', label: 'Congé pat./mat.' },
    { value: 'DEMENAGEMENT', label: 'Déménagement' },
];

export const LEAVE_TYPE_LABELS: Record<string, string> = Object.fromEntries(
    LEAVE_TYPE_OPTIONS.map(o => [o.value, o.label])
);
