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

## Protection de la branche `main`

À activer manuellement dans GitHub : **Settings → Branches → Add branch ruleset** (ou **Add rule** sur l'ancienne UI "Branch protection rules"), branche cible `main`.

Cases à cocher :

- **Require a pull request before merging** — interdit le push direct sur `main` ; seul un merge de PR est accepté.
  - Nombre d'approbations requises : `0` suffit pour un projet solo — augmenter si un second reviewer rejoint le projet.
- **Require status checks to pass before merging**
  - Cocher **Require branches to be up to date before merging**.
  - Dans la recherche de checks, ajouter les deux jobs définis par `ci.yml` : **`backend`** et **`frontend`**. (Ils n'apparaissent dans la liste qu'après avoir tourné au moins une fois sur une PR — c'est déjà fait, voir PR #45.)
- **Do not allow bypassing the above settings** — sans cette case, un admin (donc probablement ton propre compte) peut quand même push direct ou merger avec des checks rouges ; à cocher pour que la règle s'applique aussi à toi.

Optionnel, pas strictement demandé mais cohérent avec le workflow ci-dessus :
- **Require linear history** — interdit les merge commits sur `main`, force un historique propre si souhaité (le workflow actuel utilise des merges `--no-ff` `staging` → `main`, donc **ne pas cocher** si on garde cette pratique).
- La même protection appliquée à `staging` n'est pas demandée ici et casserait le "merge direct si travail solo" du cycle de vie d'une feature (§ ci-dessus) — à activer seulement si ce choix change.
