import React, { useMemo, useState } from 'react';
import { ChantierPrevision } from '../types';
import { StatTile, LegendSwatch } from './statsUi';

// Dashboard agrégé de la prévision annuelle — mêmes petits éléments partagés
// (StatTile/LegendSwatch) que GlobalStats.tsx/RhPlanningTab.tsx, même esprit
// (graphique SVG/CSS fait main, pas de nouvelle lib de charting). Recalcule
// entièrement au changement de `year`, reçu en prop depuis PrevisionAnnuelle
// (même state que la timeline juste en dessous, pour rester synchronisés).
//
// Les tuiles de comptage (countPrevu/countConfirme) sont volontairement PAS
// filtrées par année/dates comme le reste du dashboard — voir leur commentaire
// plus bas.

const MONTH_SHORT = ['Janv', 'Févr', 'Mars', 'Avr', 'Mai', 'Juin', 'Juil', 'Août', 'Sept', 'Oct', 'Nov', 'Déc'];
const PREVU_COLOR = '#fbbf24'; // tailwind amber-400 — same as PrevisionTimeline's bar
const CONFIRME_COLOR = '#10b981'; // tailwind emerald-500 — idem

const formatCHF = (v: number, compact = false) => {
    if (compact) {
        const abs = Math.abs(v);
        if (abs >= 1_000_000) return `${(v / 1_000_000).toLocaleString('fr-CH', { maximumFractionDigits: 1 })}M`;
        if (abs >= 10_000) return `${(v / 1_000).toLocaleString('fr-CH', { maximumFractionDigits: 0 })}k`;
    }
    return v.toLocaleString('fr-CH', { minimumFractionDigits: 0, maximumFractionDigits: 0 });
};

const parseISODate = (s: string) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };

// Même critère de recoupement que PrevisionTimeline.overlapsYear — un
// chantier sans les deux dates théoriques ne peut être rattaché à aucune
// année précise, donc n'entre dans aucun total ici (cohérent avec le
// calendrier, qui ne peut pas non plus lui dessiner de barre).
const overlapsYear = (item: ChantierPrevision, year: number) =>
    !!item.date_debut_theorique && !!item.date_fin_theorique &&
    item.date_debut_theorique <= `${year}-12-31` && item.date_fin_theorique >= `${year}-01-01`;

interface MonthBucket { prevu: number; confirme: number; }

interface Props {
    items: ChantierPrevision[];
    year: number;
}

const CHART_HEIGHT = 140;

export const PrevisionDashboard: React.FC<Props> = ({ items, year }) => {
    const [hoverMonth, setHoverMonth] = useState<number | null>(null);

    const itemsThisYear = useMemo(() => items.filter(i => overlapsYear(i, year)), [items, year]);

    const totalEstime = useMemo(() => itemsThisYear.reduce((s, i) => s + (i.montant_estime || 0), 0), [itemsThisYear]);
    const totalConfirme = useMemo(
        () => itemsThisYear.filter(i => i.statut === 'confirme').reduce((s, i) => s + (i.montant_estime || 0), 0),
        [itemsThisYear]
    );
    // Counts deliberately run over ALL items, not itemsThisYear: a confirmed
    // chantier with no confirmed ChantierAssignment yet (frequent — it just
    // hasn't been scheduled) has no theoretical dates, so overlapsYear drops
    // it. That's correct for the monthly chart (no month to place it in) and
    // for the CHF totals below (nothing to attribute to any specific year),
    // but "how many chantiers are prevu vs confirme" is a portfolio-level
    // fact that has nothing to do with the year filter — silently losing
    // dateless confirmed chantiers from these two tiles would make them
    // undercount exactly the case this fix exists for.
    const countPrevu = useMemo(() => items.filter(i => i.statut === 'prevu').length, [items]);
    const countConfirme = useMemo(() => items.filter(i => i.statut === 'confirme').length, [items]);

    // Répartition mensuelle : montant_estime est un forfait pour tout le
    // chantier (pas un taux mensuel) — chaque chantier apporte donc son
    // montant EN ENTIER au mois où il démarre cette année-là, sans le
    // répartir au prorata des jours. Un chantier démarré une année
    // précédente mais qui se poursuit sur l'année affichée est rattaché à
    // janvier (même logique de clamp que PrevisionTimeline.barGeometry).
    const monthly = useMemo<MonthBucket[]>(() => {
        const buckets: MonthBucket[] = Array.from({ length: 12 }, () => ({ prevu: 0, confirme: 0 }));
        for (const item of itemsThisYear) {
            if (!item.montant_estime) continue;
            const debut = parseISODate(item.date_debut_theorique!);
            const monthIdx = debut.getFullYear() < year ? 0 : debut.getMonth();
            const bucket = buckets[monthIdx];
            if (item.statut === 'confirme') bucket.confirme += item.montant_estime;
            else bucket.prevu += item.montant_estime;
        }
        return buckets;
    }, [itemsThisYear, year]);

    const maxTotal = Math.max(...monthly.map(m => m.prevu + m.confirme), 1);
    const hasAnyAmount = monthly.some(m => m.prevu + m.confirme > 0);

    return (
        <div className="space-y-4">
            <h3 className="font-black text-slate-900 uppercase tracking-widest text-sm">Dashboard {year}</h3>

            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <StatTile
                    label={`Montant estimé total ${year}`}
                    value={`${formatCHF(totalEstime, true)} CHF`}
                    sub="Tous statuts confondus"
                />
                <StatTile
                    label="Dont confirmé"
                    value={`${formatCHF(totalConfirme, true)} CHF`}
                    sub={totalEstime > 0 ? `${((totalConfirme / totalEstime) * 100).toLocaleString('fr-CH', { maximumFractionDigits: 0 })}% du total` : undefined}
                />
                <StatTile label="Chantiers prévus" value={countPrevu} sub="Toutes années confondues" />
                <StatTile label="Chantiers confirmés" value={countConfirme} sub="Toutes années confondues" />
            </div>

            <div className="card">
                <div className="flex items-center justify-between flex-wrap gap-3 mb-1">
                    <h4 className="text-sm font-bold text-slate-900 uppercase tracking-wide">Répartition mensuelle du CA prévisionnel</h4>
                    <div className="flex items-center gap-4">
                        <LegendSwatch color={PREVU_COLOR} label="Prévu" />
                        <LegendSwatch color={CONFIRME_COLOR} label="Confirmé" />
                    </div>
                </div>
                <p className="text-xs text-slate-400 mb-5">Montant attribué au mois de début théorique de chaque chantier.</p>

                {!hasAnyAmount ? (
                    <div className="text-sm text-slate-400 italic py-8 text-center">Aucun montant estimé sur {year}.</div>
                ) : (
                    <div className="flex items-end gap-1 sm:gap-2" style={{ height: CHART_HEIGHT + 28 }}>
                        {monthly.map((m, i) => {
                            const total = m.prevu + m.confirme;
                            const prevuH = (m.prevu / maxTotal) * CHART_HEIGHT;
                            const confirmeH = (m.confirme / maxTotal) * CHART_HEIGHT;
                            return (
                                <div
                                    key={i}
                                    className="flex-1 flex flex-col items-center gap-1.5 relative"
                                    onMouseEnter={() => setHoverMonth(i)}
                                    onMouseLeave={() => setHoverMonth(null)}
                                >
                                    {hoverMonth === i && total > 0 && (
                                        <div className="absolute z-20 bottom-full mb-2 bg-slate-900 text-white text-xs rounded-lg shadow-xl px-3 py-2 pointer-events-none whitespace-nowrap">
                                            <div className="font-bold">{MONTH_SHORT[i]} {year}</div>
                                            {m.prevu > 0 && <div style={{ color: PREVU_COLOR }}>Prévu : {formatCHF(m.prevu)} CHF</div>}
                                            {m.confirme > 0 && <div style={{ color: CONFIRME_COLOR }}>Confirmé : {formatCHF(m.confirme)} CHF</div>}
                                        </div>
                                    )}
                                    <div className="w-full flex flex-col justify-end" style={{ height: CHART_HEIGHT }}>
                                        {prevuH > 0 && (
                                            <div
                                                className={`w-full transition-[height] duration-300 ${confirmeH === 0 ? 'rounded-t-sm' : ''}`}
                                                style={{ height: prevuH, backgroundColor: PREVU_COLOR }}
                                            />
                                        )}
                                        {confirmeH > 0 && (
                                            <div
                                                className={`w-full transition-[height] duration-300 ${prevuH === 0 ? 'rounded-t-sm' : ''}`}
                                                style={{ height: confirmeH, backgroundColor: CONFIRME_COLOR }}
                                            />
                                        )}
                                    </div>
                                    <span className="text-[10px] font-bold text-slate-400 uppercase">{MONTH_SHORT[i]}</span>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        </div>
    );
};
