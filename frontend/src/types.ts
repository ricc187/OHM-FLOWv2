export interface User {
    id: number;
    username: string;
    role: 'admin' | 'user';
    pin?: string; // Optional for security in list views
    vacation_balance: number;
}

export type ChantierStatus = 'FUTURE' | 'ACTIVE' | 'DONE';

export interface Chantier {
    id: number;
    nom: string;
    annee: number;
    pdf_path?: string;
    address_work?: string;
    address_billing?: string;
    date_start?: string;
    date_end?: string;
    remarque?: string;
    status: ChantierStatus;
    members: number[]; // Array of User IDs
}

export interface Entry {
    id: number;
    user_id: number;
    user_name: string;
    chantier_id: number;
    chantier_nom: string;
    date: string;
    heures: number;
    materiel: number;
    status: 'PENDING' | 'VALIDATED';
    created_by_id?: number;
}

export interface Leave {
    id: number;
    user_id: number;
    user_name: string;
    type: 'VACATION' | 'SICKNESS' | 'OTHER';
    date_start: string;
    date_end: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    days_count: number;
}

export interface Alert {
    id: number;
    chantier_id: number;
    chantier_nom: string;
    title: string;
    description?: string;
    due_date?: string;
    is_resolved: boolean;
}
