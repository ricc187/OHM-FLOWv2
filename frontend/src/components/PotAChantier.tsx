import React, { useEffect, useMemo, useState } from 'react';
import { Inbox, CalendarPlus, User as UserIcon } from 'lucide-react';
import { Chantier, User } from '../types';
import { api } from '../api';
import { AgendaFormModal, AgendaFormValues, emptyFormValues } from './AgendaForm';
import { SlidingTabs } from './ui/SlidingTabs';
import { DeadlineSeverity, CARD_SEVERITY_CLASSES, BADGE_SEVERITY_CLASSES } from '../deadlineSeverity';

// Chantiers créés mais sans aucune chantier_assignment — pas encore
// planifiés. "Planifier" ouvre le même AgendaFormModal que l'Agenda, avec le
// chantier verrouillé (voir lockedChantier dans AgendaForm.tsx) : pas de
// second composant, juste ce champ en plus sur celui qui existe déjà.
interface Props {
    currentUser: User;
}

// Nombre de jours écoulés depuis la création — tant qu'un chantier est dans
// le pot (aucune assignment), c'est aussi son nombre de jours sans
// planification. null si created_at manque (chantiers créés avant l'ajout
// de cette colonne) — traité comme "date inconnue", pas comme 0 jour.
const daysUnplanned = (createdAt?: string | null): number | null => {
    if (!createdAt) return null;
    const created = new Date(createdAt);
    created.setHours(0, 0, 0, 0);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.max(0, Math.round((today.getTime() - created.getTime()) / 86400000));
};

// Même échelle de sévérité que ChantierCard (voir CARD_SEVERITY_CLASSES dans
// deadlineSeverity.ts) — juste déclenchée par "jours sans planification" au
// lieu de "jours avant deadline". Plus ça traîne, plus c'est rouge.
const unplannedSeverity = (days: number | null): DeadlineSeverity => {
    if (days === null) return 'none';
    if (days > 30) return 'overdue';
    if (days > 14) return 'urgent';
    if (days > 7) return 'alert';
    if (days > 3) return 'warning';
    return 'none';
};

type SortMode = 'oldest' | 'recent';

export const PotAChantier: React.FC<Props> = ({ currentUser: _currentUser }) => {
    const [chantiers, setChantiers] = useState<Chantier[]>([]);
    const [users, setUsers] = useState<User[]>([]);
    const [planning, setPlanning] = useState<{ chantier: Chantier; initial: AgendaFormValues } | null>(null);
    const [sortMode, setSortMode] = useState<SortMode>('oldest');

    // created_at manquant -> traité comme epoch (le plus ancien possible) :
    // ces chantiers légataires remontent en tête en mode "oldest", et en
    // queue en mode "recent" — jamais perdus au milieu du tri.
    const sortedChantiers = useMemo(() => {
        const ts = (c: Chantier) => c.created_at ? new Date(c.created_at).getTime() : 0;
        return [...chantiers].sort((a, b) => sortMode === 'oldest' ? ts(a) - ts(b) : ts(b) - ts(a));
    }, [chantiers, sortMode]);

    const fetchPot = () => {
        api.get('/api/chantiers?has_assignments=false')
            .then(res => res.ok && res.json())
            .then((data: Chantier[] | false) => data && setChantiers(data));
    };
    useEffect(() => {
        fetchPot();
        api.get('/api/users').then(res => res.ok && res.json()).then((data: User[] | false) => data && setUsers(data));
    }, []);

    const openPlanifier = (c: Chantier) => {
        const today = new Date().toISOString().split('T')[0];
        setPlanning({ chantier: c, initial: { ...emptyFormValues(today), chantierId: c.id.toString() } });
    };

    return (
        <div className="space-y-8 animate-fade-in pb-12">
            <div className="flex items-start justify-between gap-4 flex-wrap">
                <div>
                    <h2 className="text-3xl font-bold text-slate-900 flex items-center gap-3">
                        <Inbox className="text-primary" />
                        <span className="bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent">Pot à chantier</span>
                    </h2>
                    <p className="text-slate-500 mt-1">Chantiers créés mais pas encore planifiés — aucun employé affecté</p>
                </div>
                <SlidingTabs
                    tabs={[
                        { id: 'oldest', label: 'Plus anciens' },
                        { id: 'recent', label: 'Plus récents' },
                    ]}
                    active={sortMode}
                    onChange={setSortMode}
                />
            </div>

            <div className="space-y-2">
                {sortedChantiers.map(c => {
                    const days = daysUnplanned(c.created_at);
                    const severity = unplannedSeverity(days);
                    return (
                        <div key={c.id} className={`card p-4 flex items-center justify-between gap-4 flex-wrap transition-colors ${CARD_SEVERITY_CLASSES[severity]}`}>
                            <div>
                                <div className="font-bold text-slate-900 text-lg">{c.nom}</div>
                                <div className="text-sm text-slate-500 mt-1 flex items-center gap-3 flex-wrap">
                                    {c.referent_name && (
                                        <span className="flex items-center gap-1"><UserIcon size={14} /> {c.referent_name}</span>
                                    )}
                                    {c.numero && <span className="font-mono">N° {c.numero}</span>}
                                    <span>{c.created_at ? new Date(c.created_at).toLocaleDateString('fr-CH') : 'Date inconnue'}</span>
                                </div>
                            </div>

                            {/* Compteur + bouton toujours groupés à droite, quelle que soit la
                                largeur du nom du chantier à gauche — sinon le compteur dérive
                                au milieu de la ligne selon la longueur du nom. */}
                            <div className="flex items-center gap-4 shrink-0 ml-auto">
                                {/* Compteur de jours sans planification — la raison d'être de
                                    cette page, donc volontairement énorme, avec le même code
                                    couleur que les cartes chantier (deadlineSeverity). */}
                                <div
                                    className={`flex flex-col items-center justify-center rounded-2xl px-4 py-1.5 shrink-0 ${severity === 'none' ? 'text-slate-400' : BADGE_SEVERITY_CLASSES[severity]}`}
                                    title={days === null ? 'Date de création inconnue' : `Créé il y a ${days} jour${days > 1 ? 's' : ''}, jamais planifié`}
                                >
                                    <div className="text-5xl font-black leading-none tabular-nums">
                                        {days === null ? '—' : days}
                                    </div>
                                    <div className="text-[11px] uppercase tracking-wide font-semibold mt-0.5 whitespace-nowrap opacity-80">
                                        {days === null ? 'date inconnue' : days > 1 ? 'jours sans plan' : 'jour sans plan'}
                                    </div>
                                </div>

                                <button
                                    onClick={() => openPlanifier(c)}
                                    className="px-5 py-2.5 rounded-lg font-bold text-sm bg-primary text-white hover:bg-primary-dark transition-all flex items-center gap-2 shrink-0"
                                >
                                    <CalendarPlus size={16} /> Planifier
                                </button>
                            </div>
                        </div>
                    );
                })}
            </div>

            {chantiers.length === 0 && (
                <div className="text-center py-24 text-slate-400 border border-dashed border-black/5 rounded-3xl bg-white/5 backdrop-blur-sm">
                    <Inbox size={64} className="mx-auto mb-6 opacity-20 text-slate-900" />
                    <p className="text-xl font-medium">Le pot est vide — tous les chantiers sont planifiés.</p>
                </div>
            )}

            {planning && (
                <AgendaFormModal
                    mode="create"
                    initial={planning.initial}
                    users={users}
                    sidebarUserIds={users.map(u => u.id)}
                    lockedChantier={planning.chantier}
                    onClose={() => setPlanning(null)}
                    onSaved={fetchPot}
                />
            )}
        </div>
    );
};
