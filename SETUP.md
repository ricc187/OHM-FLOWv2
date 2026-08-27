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

Ensuite, éditez le fichier `.env` pour y renseigner les valeurs requises.

> **⚠️ IMPORTANT** : La variable `SECRET_KEY` est **obligatoire**. L'application refusera de démarrer si elle est absente. Générez-en une avec :
> ```bash
> python3 -c "import secrets; print(secrets.token_hex(32))"
> ```
> Puis collez le résultat dans votre `.env` :
> ```
> SECRET_KEY=votre_clef_generee_ici
> ```

## 3. Configuration CORS (si test en local)

Par défaut, le CORS est restreint à `https://ohmflow.com`. Si vous testez en local, ajoutez temporairement votre origine dans `backend/app.py` (ligne 25) :

```python
CORS(app, origins=["https://ohmflow.com", "https://www.ohmflow.com", "http://localhost"])
```

## 4. Configuration du chemin de sauvegarde (Backup)

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

---

## 5. Lancer l'application

Une fois toutes les étapes ci-dessus complétées :

```bash
docker-compose up -d --build
```

---

# Tâches à effectuer après le premier lancement

## 6. Récupérer le PIN Admin

Au premier démarrage, un compte Admin est créé automatiquement avec un **PIN aléatoire** à 6 chiffres. Ce PIN est affiché **une seule fois** dans les logs Docker.

Pour le récupérer :

```bash
docker-compose logs web | grep "Default Admin"
```

Vous verrez une ligne comme :
```
⚠️ Default Admin created with PIN: 482739 — CHANGE IT IMMEDIATELY!
```

> **⚠️ IMPORTANT** : Notez ce PIN, connectez-vous avec, puis changez-le immédiatement via l'application (l'app vous forcera à le changer au premier login).

## 7. Configurer Nginx Proxy Manager

Accédez à l'interface NPM sur `http://<IP_SERVEUR>:81` :
- **Identifiants par défaut** : `admin@example.com` / `changeme`
- Créez un Proxy Host ciblant `web:5000` (schéma `http`).
- Activez le SSL avec Let's Encrypt ou importez vos certificats `cert.pem` / `key.pem`.
