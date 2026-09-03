import { Chantier } from '../types';
import { StatusBadge } from './StatusBadge';
import { chantierPhase } from '../chantierPhase';
import { deadlineSeverity, deadlineDaysLabel, DeadlineSeverity, DEADLINE_TEXT_CLASSES } from '../deadlineSeverity';
import { Clock, User as UserIcon, CalendarClock, AlertTriangle, AlertOctagon } from 'lucide-react';

interface ChantierCardProps {
    chantier: Chantier;
    onClick: () => void;
}

// Classes appliquées sur la carte selon la sévérité deadline — regroupées
// ici (pas en dur dans le JSX) pour ajuster le rendu sans relire tout le
// composant. Fonds pleins (pas de /NN translucide) et liserés épais dès
// "warning" pour que chaque palier se voie clairement d'un coup d'œil sur
// la grille, pas juste au survol rapproché. "overdue" pousse encore plus
// loin (ring plus épais, rouge plus sombre) + le badge DÉPASSÉE en plus.
const CARD_SEVERITY_CLASSES: Record<DeadlineSeverity, string> = {
    none: '',
    warning: 'ring-2 ring-inset ring-amber-400 border-l-[6px] border-l-amber-500 bg-amber-100',
    alert: 'ring-2 ring-inset ring-orange-500 border-l-[6px] border-l-orange-600 bg-orange-100',
    urgent: 'ring-2 ring-inset ring-red-500 border-l-[6px] border-l-red-600 bg-red-100',
    overdue: 'ring-[3px] ring-inset ring-red-700 border-l-[8px] border-l-red-800 bg-red-200',
};

const BADGE_SEVERITY_CLASSES: Record<Exclude<DeadlineSeverity, 'none'>, string> = {
    warning: 'bg-amber-400 text-black',
    alert: 'bg-orange-500 text-white',
    urgent: 'bg-red-500 text-white',
    overdue: 'bg-red-700 text-white',
};

const SeverityIcon = ({ severity, size, className }: { severity: DeadlineSeverity; size: number; className?: string }) => {
    const Icon = severity === 'overdue' ? AlertOctagon : (severity === 'urgent' || severity === 'alert') ? AlertTriangle : CalendarClock;
    return <Icon size={size} className={className} />;
};

export const ChantierCard = ({ chantier, onClick }: ChantierCardProps) => {
    // Encore dans le "Pot à chantier" (aucune chantier_assignment) : grisé,
    // pas cliquable — pas d'accès détail/saisie tant qu'il n'est pas planifié.
    const inPot = chantier.has_assignments === false;
    const severity = deadlineSeverity(chantier);

    return (
        // Wrapper non affecté par l'opacity du grisage ci-dessous — c'est ce
        // qui permet à l'indicateur deadline discret de rester visible même
        // sur une carte grisée (voir plus bas). h-full + min-h fixe : toutes
        // les cartes de la grille alignent sur la même hauteur (celle du
        // contenu le plus riche : adresse + référent + deadline + heures),
        // qu'elles soient sur la même ligne ou non — sinon une carte courte
        // à côté d'une longue casse visuellement l'alignement de la grille.
        <div className="relative h-full">
            <div
                onClick={inPot ? undefined : onClick}
                className={`group relative glass-panel p-8 hover-card overflow-hidden transition-all duration-500 h-full min-h-[360px] flex flex-col ${inPot
                    ? 'opacity-50 saturate-50 cursor-not-allowed'
                    : 'cursor-pointer hover:bg-white/80'
                    } ${CARD_SEVERITY_CLASSES[severity]}`}
            >
                {/* Neon Spotlight Effect (Simulated via CSS) */}
                <div className="absolute inset-0 bg-gradient-to-br from-primary/10 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500 pointer-events-none"></div>
                <div className="absolute -inset-1 bg-gradient-to-r from-primary to-secondary rounded-2xl opacity-0 group-hover:opacity-20 blur-xl transition-opacity duration-500 group-hover:duration-200"></div>

                <div className="mb-6 relative z-10">
                    {/* Badge dans le flux (plus en absolute top-right) : sur carte
                        étroite le titre se tronque et rétrécit au lieu de passer
                        dessous la pastille de statut. */}
                    <div className="flex items-start justify-between gap-3">
                        <h3 className="min-w-0 truncate text-2xl font-black font-display text-slate-900 uppercase tracking-tighter group-hover:text-primary transition-colors drop-shadow-md">
                            {chantier.client_repere || chantier.nom}
                        </h3>
                        <div className="shrink-0 pt-1 flex items-center gap-1.5">
                            {severity === 'overdue' && (
                                <span className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wide bg-red-700 text-white animate-pulse">
                                    <AlertOctagon size={11} /> Dépassée
                                </span>
                            )}
                            <StatusBadge status={chantierPhase(chantier)} type="chantier" />
                        </div>
                    </div>
                    {/* nom = code {numero}-{commune}-{client_repere} imposé — gardé en
                        sous-titre une fois le client mis en avant ci-dessus, sauf si
                        client_repere est absent (chantiers legacy) où nom sert déjà de titre. */}
                    {chantier.client_repere && (
                        <p className="text-sm font-mono text-text-muted/70 mt-1 tracking-wide truncate">
                            {chantier.nom}
                        </p>
                    )}
                    <p className="text-sm font-mono text-primary font-bold mt-2 opacity-80 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                        <span className="w-2 h-2 rounded-full bg-primary animate-pulse"></span>
                        {chantier.annee}
                    </p>
                </div>

                <div className="space-y-4 text-sm text-text-muted relative z-10">
                    {chantier.address_work && (
                        <div className="flex items-start gap-3 group-hover:text-slate-900 transition-colors p-2 rounded-lg group-hover:bg-black/5">
                            <svg className="w-5 h-5 mt-0.5 shrink-0 text-primary/50 group-hover:text-primary transition-colors group-hover:drop-shadow-[0_0_5px_rgba(255,215,0,0.5)]" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" /><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" /></svg>
                            <span className="line-clamp-2 font-medium tracking-wide">{chantier.address_work}</span>
                        </div>
                    )}
                    {chantier.referent_name && (
                        <div className="flex items-center gap-3 group-hover:text-slate-900 transition-colors p-2 rounded-lg group-hover:bg-black/5">
                            <UserIcon size={20} className="shrink-0 text-primary/50 group-hover:text-primary transition-colors" />
                            <span className="font-mono text-xs">
                                Référent : <span className="font-bold">{chantier.referent_name}</span>
                            </span>
                        </div>
                    )}
                    {/* Toujours affiché dès qu'une deadline existe — la couleur seule
                        (ring/fond ci-dessus) ne dit jamais pourquoi sans cette date. */}
                    {chantier.deadline && (
                        <div className="flex items-center gap-3 p-2 rounded-lg group-hover:bg-black/5 transition-colors">
                            <SeverityIcon severity={severity} size={20} className={`shrink-0 ${DEADLINE_TEXT_CLASSES[severity]}`} />
                            <span className={`font-mono text-xs ${DEADLINE_TEXT_CLASSES[severity]}`}>
                                Deadline : <span className="font-bold">{chantier.deadline}</span>
                                {severity !== 'none' && <> · {deadlineDaysLabel(chantier.deadline)}</>}
                            </span>
                        </div>
                    )}

                    {typeof chantier.hours_total === 'number' && chantier.hours_total > 0 && (
                        <div className="flex items-center gap-3 p-2 rounded-lg">
                            <Clock size={20} className="shrink-0 text-primary/50" />
                            <span className="font-mono text-xs">
                                <span className="font-bold text-slate-900">{chantier.hours_total} h</span> au total
                            </span>
                        </div>
                    )}
                </div>

                {/* Footer Removed as per user request */}
            </div>

            {/* Le grisage "non planifié" reste prioritaire visuellement (opacity
                sur toute la carte ci-dessus l'assourdit déjà), mais l'urgence
                deadline ne doit pas disparaître complètement dessous — ce badge
                est un sibling du div grisé, donc sa propre opacity échappe à
                celle du parent. Discret : petite pastille coin haut-droit,
                jamais le "fond plein" réservé à la carte normale en overdue. */}
            {inPot && severity !== 'none' && (
                <div
                    className={`absolute top-3 right-3 z-20 flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-black uppercase tracking-wide shadow-md ${BADGE_SEVERITY_CLASSES[severity]}`}
                    title={`Deadline ${chantier.deadline} — ${deadlineDaysLabel(chantier.deadline!)}`}
                >
                    <SeverityIcon severity={severity} size={12} className="shrink-0" />
                    {deadlineDaysLabel(chantier.deadline!)}
                </div>
            )}
        </div>
    );
};
