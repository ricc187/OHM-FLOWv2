# Tâches à effectuer avant de lancer l'application

Voici les étapes préalables nécessaires avant de pouvoir démarrer l'application avec `docker-compose up -d`.

## 1. Génération du certificat SSL (Auto-signé)

Afin de sécuriser les connexions (HTTPS) pour l'application, un certificat SSL doit être généré. 

Exécutez la commande `openssl` suivante dans votre terminal (à la racine de votre projet ou dans le dossier où seront stockés les certificats) :

```bash
openssl req -x509 -newkey rsa:4096 -sha256 -days 365 -nodes \
    -keyout key.pem -out cert.pem \
    -subj "/CN=ohmflow.com" \
    -addext "subjectAltName=DNS:ohmflow.com,DNS:www.ohmflow.com"
```

Cette commande va créer deux fichiers :
- `key.pem` : La clé privée.
- `cert.pem` : Le certificat public.

*(Assurez-vous ensuite que Nginx Proxy Manager ou votre configuration reverse proxy est configuré pour pointer vers ces fichiers si vous n'utilisez pas directement Let's Encrypt).*

## 2. Configuration des variables d'environnement

Vous devez copier le fichier d'exemple pour créer votre configuration locale :

```bash
cp .env.example .env
```

Ensuite, éditez le fichier `.env` pour y renseigner les valeurs requises (mots de passe, base de données, etc.).

## 3. Configuration du chemin de sauvegarde (Backup)

D'origine, les sauvegardes (`.zip`) seront stockées dans un dossier local `./backups`. 
Si vous souhaitez exporter ces sauvegardes vers un autre emplacement sur votre serveur (par défaut ou un disque dur externe), vous devez modifier le fichier `docker-compose.yml`.

Ouvrez `docker-compose.yml` et sous le service `backup`, modifiez la ligne du volume :

```yaml
  backup:
    ...
    volumes:
      - ./data:/data:ro
      - /votre/chemin/absolu/vers/les/backups:/backups # <-- Modifiez cette ligne
```
