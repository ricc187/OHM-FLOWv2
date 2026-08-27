#!/bin/bash
# Script de sauvegarde complet pour OHM-FLOW (Version Docker)
# Ce script crée une archive ZIP contenant la base de données SQLite et les fichiers uploadés (PDF).

# Les dossiers /data et /backups sont mappés depuis l'hôte dans le conteneur
DATA_DIR="/data"
BACKUP_DIR="/backups"

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/ohm_flow_backup_complet_${TIMESTAMP}.zip"

echo "[$(date)] Début de la sauvegarde mensuelle..."

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
  echo "[$(date)] Sauvegarde réussie : $BACKUP_FILE"
else
  echo "[$(date)] ERREUR lors de la création de l'archive ZIP."
  exit 1
fi

# Garder uniquement les 12 dernières sauvegardes (1 an) pour ne pas saturer le disque
# ls -tp trie par date, grep -v '/$' enlève les dossiers, tail -n +13 prend tout à partir du 13ème fichier, xargs supprime
ls -tp "${BACKUP_DIR}"/ohm_flow_backup_complet_*.zip 2>/dev/null | grep -v '/$' | tail -n +13 | xargs -I {} rm -- {}

echo "[$(date)] Nettoyage des anciennes sauvegardes terminé."
