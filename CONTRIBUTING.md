# Workflow Git

Ce projet utilise un workflow à 3 niveaux : `feature` → `staging` → `main`.

## Branches

- **`main`** : réservée au code validé et prêt pour le VPS de production. Seul un merge `staging` → `main` déclenche un déploiement en prod.
- **`staging`** : zone de test partagée, accessible depuis n'importe quelle machine via git. Jamais déployée en prod. Sert à tester l'intégration de plusieurs features ensemble avant validation finale.
- **branches de feature** (`feat/...`, `fix/...`, `docs/...`) : une branche dédiée par feature, créée **depuis `staging`** (jamais depuis `main`).

## Cycle de vie d'une feature

1. Créer la branche depuis `staging` à jour :
   ```
   git checkout staging
   git pull
   git checkout -b feat/ma-feature
   ```
2. Développer et tester la feature en local.
3. Une fois terminée et testée, la merger dans `staging` :
   - via Pull Request si on veut garder une trace de la revue,
   - ou merge direct si c'est un travail solo sans besoin de trace.
4. `staging` accumule les features en cours d'intégration. On y vérifie que tout fonctionne ensemble avant de viser `main`.
5. Quand `staging` est jugée stable, un merge `staging` → `main` déclenche le déploiement en prod. Aucun merge direct `feature` → `main` n'est autorisé.

## Tester `staging`

Tester `staging` en local (comme le serveur de démo déjà en place) suffit pour la plupart des vérifications. Un environnement Docker séparé (2e environnement sur le VPS, ou VPS/sous-domaine dédié) n'est à envisager que si un besoin précis de test "comme en prod" apparaît — à évaluer au cas par cas, pas mis en place par défaut.

## CI (GitHub Actions)

`.github/workflows/ci.yml` tourne sur chaque Pull Request vers `main` et vers `staging` : job `backend` (`pip install -r requirements.txt` frais + `python -m unittest discover`) et job `frontend` (`npm ci` + `tsc --noEmit` + `npm run build`). Les deux doivent être verts pour merger une PR une fois la protection de branche (ci-dessous) activée.

## Protection de branche (active)

Deux rulesets sont activés sur GitHub (**Settings → Rules → Rulesets**), créés via l'API `gh api repos/.../rulesets` :

**`main-protection`** (branche `main`) :
- **Require a pull request before merging** — push direct interdit, seul un merge de PR est accepté. `0` approbation requise (projet solo).
- **Require status checks to pass before merging**, contexts `backend` + `frontend` (les deux jobs de `ci.yml`), branches à jour exigées.
- `bypass_actors: []` — personne, admin compris, ne peut contourner ces deux règles.

**`staging-ci-required`** (branche `staging`) :
- **Require status checks to pass before merging** seulement, mêmes contexts `backend` + `frontend` — pas de règle `pull_request`, donc le push/merge direct reste autorisé (voir "merge direct si travail solo" ci-dessus). Une PR ouverte vers `staging` doit quand même avoir la CI verte pour être mergeable.

Note : `required_status_checks` ne s'applique qu'au merge d'une PR — `ci.yml` ne se déclenche que sur `pull_request` (pas sur `push`), donc un push direct sur `staging` ne fait tourner aucun check, comme avant.

Pas de **Require linear history** sur `main` : le workflow actuel utilise des merges `--no-ff` `staging` → `main`, une règle linéaire l'interdirait.

Pour modifier ces règles : `gh api repos/ricc187/OHM-FLOWv2/rulesets/<id>` (`GET`/`PATCH`/`DELETE`), ou directement dans l'interface GitHub (Settings → Rules → Rulesets).
