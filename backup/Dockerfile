FROM alpine:latest

# Installe zip et bash
RUN apk add --no-cache zip bash

# Copie le script dans le conteneur et le rend exécutable
COPY backup.sh /usr/local/bin/backup.sh
RUN chmod +x /usr/local/bin/backup.sh

# Ajoute une tâche cron (0 2 1 * * = le 1er du mois à 2h00)
# La commande 'crond -f' lance le démon cron en premier plan pour que le conteneur reste actif
RUN echo "0 2 1 * * /usr/local/bin/backup.sh >> /var/log/backup.log 2>&1" > /etc/crontabs/root

# Démarre cron en premier plan
CMD ["crond", "-f", "-l", "2"]
