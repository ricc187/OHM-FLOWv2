FROM alpine:latest

# Installe zip, bash et rclone (envoi offsite vers Swiss Backup — voir backup.sh)
RUN apk add --no-cache zip bash rclone

# HOME explicite : crond ne le peuple pas forcément lui-même pour root, et
# backup.sh lit ~/.config/rclone/rclone.conf via $HOME (monté depuis l'hôte,
# voir DEPLOY.md).
ENV HOME=/root

# Copie le script dans le conteneur et le rend exécutable
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Ajoute une tâche cron (0 2 * * * = tous les jours à 2h00)
# La commande 'crond -f' lance le démon cron en premier plan pour que le conteneur reste actif
RUN echo "0 2 * * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

# Démarre cron en premier plan
CMD ["crond", "-f", "-l", "2"]
