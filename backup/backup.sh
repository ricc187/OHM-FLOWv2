#!/bin/bash
# Script de sauvegarde complet pour OHM-FLOW (Version Docker)
#
# Trois flux distincts :
#   1. ZIP local complet de /data (db + uploads + archives) — filet de
#      sécurité rapide, sans dépendre du réseau. Rétention locale 12 jours.
#   2. Export propre de la DB (sqlite3 .backup, ou copie brute si sqlite3
#      absent) envoyé vers Swiss Backup, avec rotation par âge.
#   3. uploads/ et archives/ synchronisés (rclone sync, pas de zip) vers
#      Swiss Backup — miroir incrémental : rclone ne retransfère que ce qui
#      a changé, contrairement à un ZIP quotidien qui change entièrement
#      même sans modification réelle du contenu.

# Les dossiers /data et /backups sont mappés depuis l'hôte dans le conteneur
DATA_DIR="/data"
BACKUP_DIR="/backups"
DB_PATH="${DATA_DIR}/chantier.db"
UPLOADS_DIR="${DATA_DIR}/uploads"
ARCHIVES_DIR="${DATA_DIR}/archives"

# Remote rclone (nom + chemin de base) — la config (~/.config/rclone/rclone.conf,
# côté hôte ./rclone.conf monté dans le conteneur, voir DEPLOY.md) doit déjà
# exister au moment de l'exécution ; ce script ne la crée pas.
RCLONE_REMOTE_BASE="swissbackup:ohmflow/"
RCLONE_CONFIG="${HOME}/.config/rclone/rclone.conf"

# Rétention côté remote — DB uniquement (voir section 3 pour pourquoi pas
# uploads/archives). Filet de sécurité, pas un historique métier. 90 jours :
# assez long pour couvrir un problème découvert tardivement, sans accumuler
# indéfiniment sur les 200 Go alloués.
REMOTE_DB_RETENTION_DAYS=90

TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/ohm_flow_backup_complet_${TIMESTAMP}.zip"
# Export DB temporaire, seulement le temps de l'envoi — pas conservé
# localement, le ZIP complet ci-dessus contient déjà la DB pour la
# rétention locale.
DB_EXPORT_FILE="${BACKUP_DIR}/.chantier_export_${TIMESTAMP}.db"

echo "[$(date)] Début de la sauvegarde quotidienne..."

if [ ! -d "$DATA_DIR" ]; then
  echo "[$(date)] ERREUR: Le dossier $DATA_DIR est introuvable."
  exit 1
fi

# --- 1. ZIP local complet ---------------------------------------------------
cd /
zip -r "$BACKUP_FILE" data/

if [ $? -eq 0 ]; then
  echo "[$(date)] Sauvegarde locale réussie : $BACKUP_FILE"
else
  echo "[$(date)] ERREUR lors de la création de l'archive ZIP locale."
  exit 1
fi

# Garder uniquement les 12 dernières sauvegardes locales (cron quotidien =
# ~12 jours d'historique local ; l'historique long terme vit sur Swiss
# Backup, pas ici)
# ls -tp trie par date, grep -v '/$' enlève les dossiers, tail -n +13 prend tout à partir du 13ème fichier, xargs supprime
ls -tp "${BACKUP_DIR}"/ohm_flow_backup_complet_*.zip 2>/dev/null | grep -v '/$' | tail -n +13 | xargs -I {} rm -- {}
echo "[$(date)] Nettoyage des anciennes sauvegardes locales terminé."

if [ ! -f "$RCLONE_CONFIG" ]; then
  echo "[$(date)] ERREUR: config rclone introuvable ($RCLONE_CONFIG) — envoi Swiss Backup ignoré ce cycle, archive locale conservée."
else
  # --- 2. DB : export propre + envoi + rotation -----------------------------
  if [ ! -f "$DB_PATH" ]; then
    echo "[$(date)] ERREUR: $DB_PATH introuvable — envoi DB ignoré."
  else
    if command -v sqlite3 >/dev/null 2>&1; then
      # .backup passe par l'API de sauvegarde SQLite — cohérent même en WAL,
      # contrairement à une copie brute du .db qui peut être prise au milieu
      # d'une écriture.
      sqlite3 "$DB_PATH" ".backup '${DB_EXPORT_FILE}'"
      db_export_status=$?
    else
      echo "[$(date)] AVERTISSEMENT: sqlite3 absent de l'image — repli sur une copie brute du fichier .db."
      cp "$DB_PATH" "$DB_EXPORT_FILE"
      db_export_status=$?
    fi

    if [ $db_export_status -ne 0 ] || [ ! -f "$DB_EXPORT_FILE" ]; then
      echo "[$(date)] ERREUR: export de la DB a échoué — envoi DB ignoré ce cycle."
    else
      rclone copy "$DB_EXPORT_FILE" "${RCLONE_REMOTE_BASE}db/" --config "$RCLONE_CONFIG"
      if [ $? -eq 0 ]; then
        echo "[$(date)] Envoi DB vers Swiss Backup réussi."

        # Rotation — seulement après un envoi réussi (même logique que pour
        # les uploads avant : pas de purge tant qu'un nouvel export n'a pas
        # pris la place des vieux). Échec traité séparément, n'affecte pas
        # le code de sortie global.
        stale_db_count=$(rclone lsf "${RCLONE_REMOTE_BASE}db/" --min-age "${REMOTE_DB_RETENTION_DAYS}d" --config "$RCLONE_CONFIG" 2>/dev/null | wc -l)
        rclone delete "${RCLONE_REMOTE_BASE}db/" --min-age "${REMOTE_DB_RETENTION_DAYS}d" --config "$RCLONE_CONFIG"
        if [ $? -eq 0 ]; then
          echo "[$(date)] Rotation DB Swiss Backup : $stale_db_count fichier(s) supprimé(s) (plus vieux que ${REMOTE_DB_RETENTION_DAYS}j)."
        else
          echo "[$(date)] ERREUR lors de la rotation DB Swiss Backup — réessai au prochain cycle."
        fi
      else
        echo "[$(date)] ERREUR lors de l'envoi DB vers Swiss Backup — pas de rotation ce cycle, réessai au prochain."
      fi
    fi

    rm -f "$DB_EXPORT_FILE"
  fi

  # --- 3. uploads/ et archives/ : miroir incrémental (rclone sync) ----------
  # sync, pas copy : on veut un vrai miroir — seuls les fichiers nouveaux ou
  # modifiés sont transférés (comparaison native rclone), et un fichier
  # supprimé/déplacé localement disparaît aussi du remote. Comportement
  # voulu ici (contrairement au ZIP db/ ci-dessus, ces dossiers ne
  # produisent pas un nouveau snapshot daté chaque jour, donc pas de
  # notion d'"ancien backup" à purger) : PAS de rotation par âge sur ces
  # chemins — un fichier vieux de plusieurs mois qui existe encore
  # localement est une donnée active (ex: photo de chantier), pas un
  # doublon de backup à supprimer.
  if [ -d "$UPLOADS_DIR" ]; then
    rclone sync "$UPLOADS_DIR" "${RCLONE_REMOTE_BASE}uploads/" --config "$RCLONE_CONFIG"
    if [ $? -eq 0 ]; then
      echo "[$(date)] Synchro uploads Swiss Backup réussie."
    else
      echo "[$(date)] ERREUR lors de la synchro uploads Swiss Backup — réessai au prochain cycle."
    fi
  fi

  if [ -d "$ARCHIVES_DIR" ]; then
    rclone sync "$ARCHIVES_DIR" "${RCLONE_REMOTE_BASE}archives/" --config "$RCLONE_CONFIG"
    if [ $? -eq 0 ]; then
      echo "[$(date)] Synchro archives Swiss Backup réussie."
    else
      echo "[$(date)] ERREUR lors de la synchro archives Swiss Backup — réessai au prochain cycle."
    fi
  fi
fi

echo "[$(date)] Sauvegarde quotidienne terminée."
