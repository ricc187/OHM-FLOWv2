export interface User {
    id: number;
    username: string;
    role: 'admin' | 'user' | 'depanneur';
    vacation_balance: number;
    must_change_password: boolean;
    mfa_enabled: boolean;
    mfa_required: boolean; // true for roles in MFA_REQUIRED_ROLES (admin) — informational, server enforces it
}

// The 3-state contract every step of the login flow funnels into (mirrors
// the backend exactly — see app.py's /api/login, /api/mfa/*).
export type LoginResult =
    | ({ status: 'ok' } & User)
    | { status: 'mfa_required'; mfa_token: string }
    | { status: 'mfa_enroll_required'; mfa_token: string };

export type ChantierStatus = 'FUTURE' | 'ACTIVE' | 'DONE';

export interface Chantier {
    id: number;
    nom: string;
    annee: number;
    pdf_path?: string; // Legacy?
    plan_pdf_path?: string; // New PDF
    address_work?: string;
    address_billing?: string;
    remarque?: string;
    status: ChantierStatus;
    archived?: boolean; // documents zipped + originals freed (set on close, cleared on reopen)
    numero?: string; // {AA}{NNNNN} nomenclature prefix, e.g. "2600347" — undefined on legacy chantiers
    commune?: string;
    client_repere?: string;
    referent_id?: number | null; // collaborateur qui a apporté le chantier — undefined sur les chantiers legacy
    referent_name?: string | null;
    created_at?: string | null; // ISO — null sur les chantiers créés avant l'ajout de cette colonne
    deadline?: string | null; // YYYY-MM-DD, optionnelle — pilote le code couleur de ChantierCard
    avancement_declare?: number | null; // 0-100, déclaré à la main par un admin (distinct des % calculés du module Finances)
    hours_total?: number;
    // true dès qu'une chantier_assignment existe (proposition ou confirmée) —
    // false = chantier encore dans le "Pot à chantier", pas encore planifié.
    has_assignments?: boolean;
    members: number[]; // Array of User IDs
}

// Unified shape returned by GET /api/calendar — one leave or chantier
// assignment, already merged/typed server-side (see app.py get_calendar).
export type CalendarSource = 'leave' | 'chantier';

export interface CalendarItem {
    id: number;
    source: CalendarSource;
    type: string; // LeaveType value when source='leave', 'chantier' when source='chantier'
    user_id: number;
    chantier_id: number | null;
    titre: string;
    date_debut: string; // YYYY-MM-DD
    heure_debut: string | null; // HH:MM, null when toute_la_journee
    date_fin: string;
    heure_fin: string | null;
    toute_la_journee: boolean;
    description: string | null;
    status: 'PENDING' | 'APPROVED' | 'REJECTED' | null; // null for source='chantier'
    couleur: string; // hex
    // "Chantier à planifier" — several candidate dates blocked provisionally
    // until the client confirms one. null/'confirme' for everything else
    // (leaves never carry this — always null there).
    statut: 'confirme' | 'proposition' | null;
    proposal_group_id: string | null;
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
    status: 'PENDING' | 'VALIDATED';
    created_by_id?: number;
    admin_note?: string;
    // Obligatoire pour toute nouvelle saisie (voir POST /api/entries) — optionnel
    // ici seulement pour les entries créées avant l'ajout de cette colonne.
    description?: string | null;
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

// --- Module prévision annuelle ---
// Totalement indépendant de l'Agenda / chantier_assignments / financier —
// voir backend/app.py (ChantierPrevision). Le seul lien avec un chantier réel
// est chantier_id, en lecture seule (jamais réécrit depuis le frontend).

export type PrevisionStatut = 'prevu' | 'confirme';

export interface ChantierPrevision {
    id: number;
    nom: string;
    referent_id: number | null;
    referent_username: string | null;
    montant_estime: number | null;
    date_debut_theorique: string | null; // YYYY-MM-DD
    date_fin_theorique: string | null; // YYYY-MM-DD
    statut: PrevisionStatut;
    chantier_id: number | null;
    created_at: string | null;
}

export interface PrevisionImportResult {
    created_count: number;
    already_imported_count: number;
    created: ChantierPrevision[];
}

// CONGE/MALADIE/ABSENCE/ARMEE/CONGE_PAT_MAT/DEMENAGEMENT mirror the backend
// Leave.type enum (renamed from VACATION/SICKNESS/OTHER — see app.py's
// leaves type migration). HOLIDAY is frontend-only (synthetic calendar entries,
// see Planning.tsx's CalendarView), never sent to/from the API.
export type LeaveType = 'CONGE' | 'MALADIE' | 'ABSENCE' | 'ARMEE' | 'CONGE_PAT_MAT' | 'DEMENAGEMENT' | 'HOLIDAY';

export interface Leave {
    id: number;
    user_id: number;
    user_name: string;
    type: LeaveType;
    date_start: string;
    date_end: string;
    status: 'PENDING' | 'APPROVED' | 'REJECTED';
    days_count: number;
    admin_note?: string;
    heure_debut?: string;
    heure_fin?: string;
    toute_la_journee?: boolean;
    description?: string;
    created_by_id?: number;
    created_by_name?: string;
    updated_by_id?: number;
    updated_by_name?: string;
    updated_at?: string;
}

