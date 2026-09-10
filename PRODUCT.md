# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

*(Inféré du code et README — pas d'entretien, voir note de substitution.)* Deux rôles : `admin` (gestion, validation, administration) et `user` (électriciens/équipes de chantier sur le terrain, mobile-first). Les `user` saisissent heures/matériel et demandes de congé au quotidien depuis un téléphone sur ou entre les chantiers ; les `admin` pilotent depuis un poste fixe ou mobile (validation des saisies, gestion des chantiers, finances, utilisateurs).

## Product Purpose

OhmFlow gère les chantiers d'une entreprise d'électricité/construction : suivi des heures et matériel par chantier ("Saisie"), planning d'équipe et congés, gestion administrative des utilisateurs, suivi financier (liens Volta offre/facture), suivi kilométrique des véhicules de service, prévisions annuelles de chantiers. Le succès se mesure à la fiabilité des données de facturation/paie qui en sortent (heures validées, kilométrage relevé, factures liées) — pas à un usage occasionnel.

## Positioning

*(Inféré, à confirmer.)* Outil interne métier (pas un produit commercial concurrentiel) : sa valeur est la couverture verticale complète du cycle chantier électricité/construction (saisie terrain → validation admin → facturation Volta → export comptable), pas une brique isolée qu'un concurrent générique (feuille de temps SaaS générique) pourrait copier telle quelle.

## Operating Context

- Terrain : saisie rapide sur mobile, souvent en conditions de chantier (gants, luminosité, connexion imparfaite).
- Bureau : validation des saisies, gestion financière (Volta), administration des utilisateurs, prévisions annuelles.
- Intégration externe : synchronisation avec Volta (offres/factures) via un worker de sync périodique.
- Déploiement : Docker Compose, reverse-proxy Caddy en HTTPS, VPS ; sauvegardes incrémentales (SQLite + rclone vers Swiss Backup).
- Sécurité : MFA obligatoire pour certains rôles (`MFA_REQUIRED_ROLES`), gate onboarding (changement de mot de passe forcé, enrôlement MFA).

## Capabilities and Constraints

- Gestion de chantiers : détail, statuts de phase (non planifié / en cours / terminé), assignation d'équipe, alertes, documents.
- Saisie heures/matériel avec délégation admin et workflow de validation.
- Congés : demande, approbation/rejet.
- Véhicules : fiche véhicule + relevé kilométrique hebdomadaire (popup bloquant tant que non répondu), km_actuel = valeur absolue (pas un delta).
- Prévisions annuelles de chantiers.
- Volta : liens offre/facture par chantier, `numero_facture` optionnel à la création, obligatoire seulement à la clôture du chantier.
- Suppression en cascade de chantiers (admin uniquement, bloquée si le chantier a des assignations actives) avec double confirmation partout où une action est destructrice.
- Rôle `user` : accès restreint (ex. pas de visibilité sur le "Pot à chantier" financier).
- Stack : React (Vite) + TypeScript + Tailwind, Lucide icons, Flask + SQLAlchemy + SQLite côté backend.

## Brand Commitments

Nom : **OhmFlow** / **OHM-FLOW**. Ton du README orienté "électriciens et équipes de construction". Pas de charte graphique documentée au-delà du code existant (palette `ohm-*` / `status-*` dans Tailwind) — voir `/impeccable document` pour figer un DESIGN.md à partir de l'implémentation actuelle si besoin.

## Evidence on Hand

Aucun asset marketing (témoignages, études de cas, presse) trouvé dans le repo — à ne pas inventer. Image de bannière README venant d'un stock Unsplash générique (`OhmFlow Banner`), pas une preuve produit.

## Product Principles

1. Fiabilité des données financières/RH avant tout (heures, km, factures) — pas de raccourci qui fragilise la traçabilité.
2. Mobile-first pour le terrain, densité d'info plus élevée acceptable côté admin/bureau.
3. Destructif = confirmation double, systématiquement (pattern déjà en place via `ConfirmDialog`/`useConfirm`).
4. Rôle `user` voit strictement ce qui le concerne ; les vues financières/administratives restent réservées à `admin`.

## Accessibility & Inclusion

Aucune exigence a11y formelle documentée dans le repo. `prefers-reduced-motion` déjà respecté dans les transitions CSS (`index.css`) — à maintenir dans tout travail de polish/animation à venir.
