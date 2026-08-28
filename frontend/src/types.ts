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
    numero?: string; // {AA}{NNNNN} nomenclature prefix, e.g. "2600347" — undefined on legacy chantiers
    commune?: string;
    client_repere?: string;
    hours_total?: number;
    members: number[]; // Array of User IDs
}

export interface AdminNotice {
    id: number;
    message: string;
    date_start: string; // YYYY-MM-DD
    duration_days: number;
    active: boolean;
    created_by: string | null;
    created_at: string | null;
}

export type DocumentCategory = 'document' | 'photo';

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

// --- Module financier ---

export interface ChantierFinancierPrevu {
    id: number;
    chantier_id: number;
    charge_materiel_prevue: number;
    taux_horaire: number;
    pct_petites_fournitures: number;
    created_at?: string;
    updated_at?: string;
}

// Une ligne du CA prévisionnel (adjugé / régie / PV clients / ...) — liste à
// taille libre, plus 3 champs fixes : un chantier peut n'avoir qu'une ligne,
// un autre 5.
export interface CaLignePrevue {
    id: number;
    chantier_id: number;
    libelle: string;
    montant: number;
    heures: number;
    created_at?: string;
}

export interface Acompte {
    id: number;
    chantier_id: number;
    libelle: string;
    montant: number;
    // Heures réellement travaillées/facturées en face de ce versement —
    // laissée à 0 par erreur = signal qu'il manque des heures à facturer.
    heures: number;
    date: string;
    created_at?: string;
}

export type AchatType = 'facture' | 'estimation_petites_fournitures';

export interface AchatMateriel {
    id: number;
    chantier_id: number;
    libelle: string;
    montant: number;
    date?: string | null;
    type: AchatType;
    created_at?: string;
}

// Calculs dynamiques renvoyés par GET/PUT /financier — absents quand
// `financier` est null (prévisionnel pas encore créé).
export interface FinancierCalculs {
    heures_reelles: number;
    ca_prevu: number;
    heures_prevues: number;
    ca_reel: number;
    reste_a_facturer: number;
    total_achats_reel: number;
    ecart_materiel: number;
    cout_mo_prevu: number;
    cout_mo_reel: number;
    ecart_heures: number;
    ecart_cout_mo: number;
    marge_prevue: number;
    pct_marge_prevue: number | null;
    marge_reelle: number;
    pct_marge_reelle: number | null;
    ecart_marge: number;
    // Débours sec = coût direct (main d'œuvre + matériel) et son avancement.
    debourse_sec_prevu: number;
    debourse_sec_reel: number;
    pct_avancement_ca: number | null;
    pct_avancement_materiel: number | null;
    pct_avancement_mo: number | null;
    pct_avancement_debourse_sec: number | null;
}

export interface FinancierPayload extends Partial<FinancierCalculs> {
    chantier_id: number;
    financier: ChantierFinancierPrevu | null;
    ca_lignes: CaLignePrevue[];
    acomptes: Acompte[];
    achats: AchatMateriel[];
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

