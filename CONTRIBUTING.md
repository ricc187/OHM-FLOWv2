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
