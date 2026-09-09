#!/bin/bash
# Script de sauvegarde complet pour OHM-FLOW (Version Docker)
# Ce script crée une archive ZIP contenant la base de données SQLite et les fichiers uploadés (PDF),
# puis l'envoie en copie distante (offsite) sur Swiss Backup via rclone.

# Les dossiers /data et /backups sont mappés depuis l'hôte dans le conteneur
DATA_DIR="/data"
BACKUP_DIR="/backups"

# Remote rclone (nom + chemin) — la config (~/.config/rclone/rclone.conf,
# côté hôte ./rclone.conf monté dans le conteneur, voir DEPLOY.md) doit déjà
# exister au moment de l'exécution ; ce script ne la crée pas.
RCLONE_REMOTE="swissbackup:ohmflow/"
RCLONE_CONFIG="${HOME}/.config/rclone/rclone.conf"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/ohm_flow_backup_complet_${TIMESTAMP}.zip"

echo "[$(date)] Début de la sauvegarde quotidienne..."

# Vérifier que le dossier data existe
if [ ! -d "$DATA_DIR" ]; then
  echo "[$(date)] ERREUR: Le dossier $DATA_DIR est introuvable."
  exit 1
fi

# Archiver le dossier data (qui contient chantier.db et uploads/)
# -j empêche de répliquer toute l'arborescence absolue, mais ici on veut garder la structure relative data/
cd /
zip -r "$BACKUP_FILE" data/

if [ $? -eq 0 ]; then
  echo "[$(date)] Sauvegarde locale réussie : $BACKUP_FILE"
else
  echo "[$(date)] ERREUR lors de la création de l'archive ZIP."
  exit 1
fi

# Envoi offsite vers Swiss Backup — échec indépendant du ZIP local ci-dessus,
# qui vient d'être créé avec succès et reste le filet de sécurité même si
# l'envoi distant échoue. `copy` (pas `sync`) : on envoie un seul fichier,
# `sync` traiterait tout ce qui n'est pas ce fichier comme "en trop" côté
# distant et le supprimerait — copy ajoute/actualise sans jamais rien effacer
# côté remote.
if [ ! -f "$RCLONE_CONFIG" ]; then
  echo "[$(date)] ERREUR: config rclone introuvable ($RCLONE_CONFIG) — envoi Swiss Backup ignoré, archive locale conservée."
else
  rclone copy "$BACKUP_FILE" "$RCLONE_REMOTE" --config "$RCLONE_CONFIG"
  if [ $? -eq 0 ]; then
    echo "[$(date)] Envoi Swiss Backup réussi : $RCLONE_REMOTE"
  else
    echo "[$(date)] ERREUR lors de l'envoi vers Swiss Backup (rclone) — archive locale conservée, réessai au prochain cycle."
  fi
fi

# Garder uniquement les 12 dernières sauvegardes locales (cron quotidien =
# ~12 jours d'historique local ; l'historique long terme vit sur Swiss
# Backup, pas ici)
# ls -tp trie par date, grep -v '/$' enlève les dossiers, tail -n +13 prend tout à partir du 13ème fichier, xargs supprime
ls -tp "${BACKUP_DIR}"/ohm_flow_backup_complet_*.zip 2>/dev/null | grep -v '/$' | tail -n +13 | xargs -I {} rm -- {}

echo "[$(date)] Nettoyage des anciennes sauvegardes locales terminé."
