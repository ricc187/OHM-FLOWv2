export interface User {
    id: number;
    username: string;
    role: 'admin' | 'user' | 'depanneur';
    pin?: string; // Optional for security in list views
    vacation_balance: number;
}

export type ChantierStatus = 'FUTURE' | 'ACTIVE' | 'DONE';

export interface Chantier {
    id: number;
    nom: string;
    annee: number;
    pdf_path?: string; // Legacy?
    plan_pdf_path?: string; // New PDF
    address_work?: string;
    address_billing?: string;
    date_start?: string;
    date_end?: string;
    remarque?: string;
    status: ChantierStatus;
    archived?: boolean; // documents zipped + originals freed (set on close, cleared on reopen)
    members: number[]; // Array of User IDs
}

export type DocumentCategory = 'plan' | 'devis' | 'photo';

export interface ChantierDocument {
    id: number;
    chantier_id: number;
    category: DocumentCategory;
    filename: string;
    size_bytes: number;
    mimetype: string;
    uploaded_by?: string;
    uploaded_at?: string;
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
    admin_note?: string;
}

export interface Leave {
    id: number;
    user_id: number;
    user_name: string;
    type: 'VACATION' | 'SICKNESS' | 'OTHER' | 'HOLIDAY';
    date_start: string;
    date_end: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    days_count: number;
    admin_note?: string;
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
