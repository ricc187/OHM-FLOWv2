# Déploiement Docker

Étapes pour lancer l'application via `docker compose`. Exposition publique
par tunnel Cloudflare (`cloudflared`) — pas de port ouvert sur l'hôte, pas de
certificat à gérer, pas de nom de domaine requis.

## 1. Configuration des variables d'environnement

```bash
cp .env.example .env
```

Éditez `.env` :

- **`SECRET_KEY`** (obligatoire — l'app refuse de démarrer sans) : signe les
  cookies de session. Générez-en une :
  ```bash
  python3 -c "import secrets; print(secrets.token_hex(32))"
  ```
- **`MFA_ENCRYPTION_KEY`** (recommandé) : chiffre les secrets TOTP (2FA) en
  base — clé Fernet, distincte de `SECRET_KEY`. Si absente, une clé est
  générée et persistée dans `backend/.mfa_key` au premier démarrage (marche,
  mais dépend alors de ce fichier — le fixer explicitement ici est plus sûr
  pour un redéploiement propre). Générez-en une :
  ```bash
  python3 -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"
  ```
- **`FLASK_ENV=production`** — active le cookie `Secure` (HTTPS uniquement).

## 2. Lancer l'application

```bash
docker compose up -d --build
```

Trois services : `web` (l'app), `backup` (zip mensuel de `data/` vers
`./backups`), `cloudflared` (tunnel public). `web` n'a aucun port publié sur
l'hôte — seul `cloudflared` y accède, via le réseau interne de compose.

## 3. Récupérer le lien public

```bash
docker compose logs cloudflared | grep -o 'https://[a-zA-Z0-9-]*\.trycloudflare\.com'
```

C'est un tunnel **quick** (gratuit, sans compte Cloudflare) : l'URL change à
chaque redémarrage du conteneur `cloudflared`. Pour un lien stable, il faut
un tunnel Cloudflare nommé (compte + domaine Cloudflare) — hors scope ici.

## 4. Récupérer le mot de passe Admin temporaire

Un compte `Admin` est créé au premier démarrage avec un **mot de passe
aléatoire**, affiché une seule fois dans les logs :

```bash
docker compose logs web | grep "Default Admin"
```

```
⚠️ Default Admin created with PASSWORD: xxxxxxxxxxxxxxxx — CHANGE IT IMMEDIATELY! (2FA setup required on first login)
```

Connectez-vous avec, l'app forcera un changement de mot de passe immédiat —
et, le rôle `admin` exigeant la 2FA, un enrôlement TOTP (scanner un QR code)
juste après.

## Notes

- **Emplacement des sauvegardes** : par défaut `./backups`. Pour un autre
  chemin, modifiez le volume du service `backup` dans `docker-compose.yml`.
- **Sauvegarder `backend/.mfa_key`** (si `MFA_ENCRYPTION_KEY` n'est pas fixée
  dans `.env`) au même titre que `data/` — sans elle, les secrets 2FA déjà
  chiffrés en base deviennent illisibles et tous les admins doivent
  réenrôler leur 2FA.
- **CORS** : aucun à configurer — le frontend est servi par Flask lui-même
  (même origine), pas d'appel cross-origin.
