# Volta API — exploration et mapping proposé vers `chantier_financier`

Exploration menée avec les vraies credentials (compte "Atelier E SA", ATE-ATE-1)
contre l'API Volta v3 réelle, sur le chantier "Immeuble la Baïta" (Debons
Architecture, projet Volta `024042.001`), comparé à la fixture de test
`backend/tests/test_financier_calculs.py` (`LA_BAITA_*`) et au classeur Excel
de référence retrouvé sur le disque (`La_Baita_modele_corrige_1.xlsx`, feuille
"Baïta").

Script d'exploration : `scripts/explore_volta_api.py` (isolé, non intégré à
l'app). Dumps bruts dans `scripts/volta_dumps/` (gitignored, jamais commités —
contiennent des données client réelles).

**Aucun code de production touché.** Exploration et documentation uniquement.

## Budget de requêtes respecté

Contrainte : max ~10 req/heure sur l'API métier, pas plus d'une demi-douzaine
d'appels au total pour toute la tâche. **6 requêtes métier effectuées**, plus
1 requête (non concernée par la limite) sur le endpoint public de spec :

| # | Horodatage | Requête |
|---|---|---|
| — | 09:47 (approx.) | `GET https://app.myvolta.ch/volta-api/v3/api-docs` (spec publique, hors quota) |
| 1 | 2026-09-04T09:49:54 | `POST /authenticate` |
| 2 | 2026-09-04T09:49:55 | `GET /v2/projects?orgUnitCode=ATE-ATE-1` |
| 3 | 2026-09-04T09:50:31 | `POST /authenticate` |
| 4 | 2026-09-04T09:50:32 | `GET /v2/offers?orgUnitCode=...&projectMainNumber=24042&projectSubNumber=1` |
| 5 | 2026-09-04T09:50:32 | `GET /v2/contracts?orgUnitCode=...&projectMainNumber=24042&projectSubNumber=1` |
| 6 | 2026-09-04T09:50:32 | `GET /v2/reports?orgUnitCode=ATE-ATE-1` |

Aucune boucle, aucun retry, aucun polling. Le script accepte des arguments
(`projects`, `financials <main> <sub>`) pour être rejoué manuellement, un lot
à la fois, si une suite d'exploration est nécessaire plus tard — **à faire
au compte-goutte** (pas avant un bon moment, pour rester sous la limite
horaire cumulée avec cette session).

## Authentification (flow réel confirmé)

Contrairement à l'hypothèse de départ ("/v2/projects" etc.), le préfixe `/v2`
correspond bel et bien aux vrais chemins actuels (la doc elle-même est en
"v3" au sens du numéro de version de l'API-doc, mais les routes affichées
restent `/v1`, `/v2`, ou sans préfixe pour l'auth) :

- `POST {VOLTA_API_BASE_URL}/authenticate`
- Corps JSON : `{ "username": ..., "password": ..., "clientAccountCode": ... }`
  (les query params équivalents existent mais sont dépréciés dans le spec)
- Réponse `LoginResponse` : `{ access_token, user_id, client_account_code, employee_key }`
- Toutes les routes `/v2/*` s'utilisent ensuite avec `Authorization: Bearer <access_token>`

Confirmé fonctionnel : `POST /authenticate` a répondu `200` avec les
credentials du `.env` (non reproduites ici). La réponse renvoie bien
`user_id`/`client_account_code` égaux aux valeurs `.env` (compte de service),
et `employee_key = null` (pas un employé nommé, c'est un compte API).

## Endpoints réels confirmés utilisés

| Endpoint | Filtre utilisé | Résultat sur La Baita |
|---|---|---|
| `GET /v2/projects?orgUnitCode=ATE-ATE-1` | aucun filtre texte disponible côté API — liste complète (87 projets), filtrage client-side sur `mainTitle`/`subTitle` | trouvé : `024042.001`, `mainTitle="Debons Architecture"`, `subTitle="Immeuble la Baïta"`, `type="K"` (Kundenprojekt) |
| `GET /v2/offers?orgUnitCode=...&projectMainNumber=24042&projectSubNumber=1` | requiert `modifiedAfter` (mis à une date ancienne) | **0 offre** — cohérent avec `type="K"` (projet client direct, pas un projet d'offre `"O"`) |
| `GET /v2/contracts?orgUnitCode=...&projectMainNumber=24042&projectSubNumber=1` | idem | **8 contrats** — voir mapping ci-dessous |
| `GET /v2/reports?orgUnitCode=ATE-ATE-1` | pas de filtre par projet exposé par le spec (seulement `orgUnitCode`/`modifiedAfter`/`reportTypes`) | **10 rapports** retournés, **aucun ne concerne le projet 24042** (tous liés à d'autres chantiers : 24000, 24041, 24070) |

Le endpoint spec réel documente aussi (non appelés, hors budget) :
`GET /v2/documents`, `GET /v2/documents/invoice-amount`, `PUT /v2/reports/billable`,
`POST /v2/reports/positions`, `GET /v1/{orgUnitCode}/reports` — pistes pour
confirmer la facturation réelle et les heures pointées (voir Questions ouvertes).

## Découverte clé : les 8 "contrats" de La Baita reconstituent exactement le CA prévisionnel Excel/fixture

Le projet Volta `024042.001` a **8 documents de type contrat**, tous rattachés
au même `projectMainNumber`/`projectSubNumber` :

| documentNr | shortDescription | totalAmountExclVat (CHF) | workH + technicalElaborationH |
|---|---|---:|---:|
| 6153 | Immeuble la Baïta | **145 750.05** | 919.13 + 133.27 = **1052.40** |
| 6638 | Baïta - Appartement Richard | 3 074.80 | — |
| 6803 | Baïta - Appartement Chappot | 1 436.50 | — |
| 6804 | Baïta - Appartement Frezzimmo | 2 684.55 | — |
| 6930 | Baïta - Appartement 20 Besse | 4 221.45 | — |
| 6929 | Baïta - Appartement 21 Feluba SA | 2 721.25 | — |
| 7019 | Baïta - Appartement Salvagni | 10 684.70 | — |
| 6696 | Baïta - Appartement Wüst | 8 163.60 | — |
| **Somme des 7 sous-contrats "Appartement..."** | | **32 986.85** | |

Comparé à la fixture `LA_BAITA_CA_MONTANTS = [145750.05, 2734.8, 32986.85]` (adjugé / régie / PV clients) :

- **145 750.05 = exactement** le `totalAmountExclVat` du contrat principal `6153`
  → c'est la ligne **adjugé**.
- `919.13 + 133.27 = 1052.40 ≈ 1052` (heures adjugées, écart 0.4h probablement
  un arrondi de saisie) → confirme le rapprochement.
- **32 986.85 = exactement** la somme des 7 sous-contrats "Appartement X"
  → c'est la ligne **PV clients** (facturation directe aux copropriétaires,
  un contrat Volta séparé par appartement).
- **2 734.8 (régie)** n'a **pas** été retrouvé parmi ces 8 contrats ni parmi
  les rapports remontés par `/v2/reports` — **mais a été retrouvé en Round 3**
  sous forme de facture Volta séparée (n° 7098, type `RECHNUNG_NPK`), pas un
  contrat/offre/rapport. Voir Round 3 plus bas.

## Réponse à la question : adjugé / régie / PV clients, documents séparés ou fusionnés côté Volta ?

**Séparés — confirmé, et même plus séparés que prévu.** Ce ne sont pas trois
champs d'un même document Volta, ni des sous-totaux internes à un seul
contrat : ce sont **des documents Volta distincts, et de deux types Volta
différents** :
- 1 contrat (`VERTRAG_NPK`) "chantier" = ligne adjugé,
- N contrats (`VERTRAG_NPK`) "par appartement" = lignes PV clients (autant
  de lignes que de copropriétaires facturés séparément),
- 1 **facture** (`RECHNUNG_NPK`) autonome, sans contrat/offre associé
  retrouvé = ligne régie (facture Volta n° 7098, confirmée en Round 3) —
  vraisemblablement des travaux facturés directement sans passer par
  l'étape contrat formel, plausible pour un montant de régie modeste.

Le champ `chantier_financier`/`CaLignePrevue` (liste à taille libre chez
nous) est donc une **agrégation manuelle côté OHM-FLOW de plusieurs
documents Volta hétérogènes** (contrats ET factures), pas seulement de
contrats comme supposé après le round 1.

Ceci confirme aussi que **`CaLignePrevue` en taille libre était le bon choix
de modélisation** (vs. 3 champs fixes) : le nombre de contrats Volta par
chantier varie réellement (1 à 8 ici), donc l'agrégation ne peut pas être
figée à 3.

## Tableau de mapping proposé — champ Volta ↔ `chantier_financier`

| Champ `chantier_financier` / tables liées | Équivalent Volta trouvé | Confiance |
|---|---|---|
| `CaLignePrevue.montant` (ligne "adjugé") | `ContractOutDto.totalAmountExclVat` du contrat "principal" du projet | **Haute** — match exact observé (145750.05) |
| `CaLignePrevue.heures` (ligne "adjugé") | `ContractOutDto.sums.workH + sums.technicalElaborationH` de ce même contrat | Haute — match à 0.4h près |
| `CaLignePrevue.montant` (ligne "PV clients") | Somme des `totalAmountExclVat` des contrats "secondaires" (un par appartement/tiers facturé séparément) du même projet | **Haute** — match exact observé (32986.85) |
| `CaLignePrevue.montant` (ligne "régie") | `Document.type=RECHNUNG_NPK` — trouvé via `GET /v2/documents?invoiceNumber=7098` (voir Round 3) | **Haute** — match exact confirmé (2734.80 CHF), mais nécessite de connaître le numéro de facture au préalable (pas listable par projet) |
| `charge_materiel_prevue` (66 824 CHF) | Proche mais **pas égal** à `ContractOutDto.sums.materialCHF` du contrat principal (64 201.75 CHF, écart ≈ 2 622 CHF / 4%) | **Moyenne** — probablement une valeur corrigée manuellement (le fichier Excel de référence s'appelle "modèle corrigé"), pas un miroir live du contrat |
| `taux_horaire` (71 CHF/h) | Aucun champ direct trouvé dans `Project`/`ContractOutDto`. Piste non explorée (budget requêtes épuisé) : `/v2/catalogs/simple`, `/v2/employees`, ou configuration client-account | **Aucune trouvée** |
| `Acompte` (montants réellement encaissés/facturés, CA réel) | `Document.type=RECHNUNG_NPK`, trouvable via `GET /v2/documents?invoiceNumber=X` **si on connaît déjà X** (mécanisme confirmé en Round 3 avec la régie/7098) — mais pas listable par projet, donc 2 des 3 acomptes (117 600 + 29 400 CHF) restent non vérifiés faute de numéro connu | **Moyenne** — mécanisme prouvé, 1/3 confirmé, 2/3 à traiter autrement (obtenir les numéros ailleurs) |
| `AchatMateriel` (achats réels, 51 578.65 CHF) | Non exploré — piste : `/v2/wholesalers`, `/v2/documents` (factures fournisseurs) ou module hors périmètre API | **Aucune trouvée** |
| `heures_reelles` (pointages réels, 1823.75 h) | Non exploré directement — les `Report.workPositions[].timesheetEntryId` suggèrent un lien vers un module de pointage, potentiellement `/v1/{orgUnitCode}/reports` ou un endpoint non listé | **Aucune trouvée** |
| `Chantier.nom` | `Project.subTitle` (le `mainTitle` est plutôt le nom du client/mandataire — ici "Debons Architecture" pour le titre, "Immeuble la Baïta" en sous-titre) | Haute |
| `Chantier` (numéro/réf) | `Project.projectNumber` (`"024042.001"`), `mainNumber`+`subNumber` | Haute |
| — | `Project.projectLead`, `siteManager`, `clerk`, `costCenterCode`, `addresses[]` | Champs Volta **sans équivalent** dans `chantier_financier` actuel |
| — | `ContractOutDto.vat`, `vatRate`, `paymentCondition`, `invoiced`, `cancelled` | Champs Volta **sans équivalent** côté nous (pas de TVA/CGV modélisées dans `chantier_financier`) |
| `pct_petites_fournitures` | Aucun équivalent Volta trouvé — concept propre à OHM-FLOW (règle métier interne de calcul auto de la ligne "petites fournitures") | **Aucune trouvée** — normal, c'est une règle OHM-FLOW pas Volta |

## Champs Volta sans équivalent chez nous

- `Project.type` (O/K/S/G — Offertprojekt/Kundenprojekt/Serviceprojekt/…)
- `ContractOutDto.sums.flatRatesCHF/H`, `recommendedPriceCHF/H`, `technicalElaborationCHF/H` (granularité plus fine que notre `charge_materiel_prevue`/`taux_horaire`)
- `vat` / `vatRate` / `paymentCondition` (TVA et conditions de paiement — absentes du modèle financier actuel)
- `Report.reportType` (E/V/P — non documenté dans le spec, à clarifier avec le support Volta)
- Adresses de facturation/chantier distinctes (`invoiceAddressNumber`/`siteAddressNumber`) — chez nous un seul `Chantier` sans distinction adresse facturation/site

## Champs `chantier_financier` sans équivalent trouvé côté Volta

- `taux_horaire` (valeur globale utilisée pour calculer `cout_mo_prevu`/`cout_mo_reel`)
- `pct_petites_fournitures`
- Le CA réel (`Acompte`) et les achats réels (`AchatMateriel`) — existent sûrement quelque part côté Volta (facturation, achats fournisseurs) mais pas confirmés dans le budget de requêtes de cette tâche

## Limitation signalée

Un classeur Excel de référence a bien été retrouvé sur le disque
(`C:\Users\Riccardo\Downloads\La_Baita_modele_corrige_1.xlsx` et sa variante
`_1`), en plus de la fixture de test. Les deux sources sont cohérentes entre
elles (mêmes montants : CA prévu 181 471.70, CA réel 149 734.80, charge
matériel 66 824, etc.), ce qui a permis de croiser les résultats Volta avec
deux références indépendantes. Le nom du fichier ("modèle corrigé") suggère
que certaines valeurs (notamment `charge_materiel_prevue`) ont fait l'objet
d'une correction manuelle par rapport aux chiffres bruts de Volta — d'où
l'écart de ~4% constaté sur le matériel.

## Round 2 (2026-09-04, suite) — régie, facturation réelle, panneau debug

Reprise de l'exploration avec les vraies données du chantier "La Baita" (id
**15** en base, `2600030-Martigny-Baita`) désormais importées dans l'app
(`GET /api/chantiers/15/financier`, hors quota Volta — c'est notre propre
API) : confirme intégralement la fixture de test (mêmes `ca_lignes`,
`acomptes`, `achats`), avec en plus un détail utile ici — un des acomptes
réels est explicitement libellé **"regie 1"** pour **2734.80 CHF**, montant
identique à la ligne CA "travaux en régie". La régie a donc bien été
facturée et encaissée côté OHM-FLOW ; la question est uniquement de savoir
si Volta porte une trace de ce document.

### Nouvelles requêtes métier (budget séparé, 4 requêtes)

| # | Horodatage | Requête |
|---|---|---|
| 1 | 2026-09-04T10:58:08 | `POST /authenticate` |
| 2 | 2026-09-04T10:58:08 | `GET /v2/reports?orgUnitCode=ATE-ATE-1&modifiedAfter=1704067200000&reportTypes=E,V,P` (couvre toute la durée du chantier, 2024-01-01 → maintenant, les 3 types de rapport) |
| 3 | 2026-09-04T10:58:58 | `POST /authenticate` |
| 4 | 2026-09-04T10:58:59 | `GET /v2/documents?orgUnitCode=ATE-ATE-1&documentNumber=6153` (le document du contrat principal "adjugé") |

Total cumulé sur les deux passes : **10 requêtes métier** (6 + 4), toujours
sans boucle/retry/polling.

### Résultat régie — introuvable via l'API, confirmé négatif

`GET /v2/reports` avec une fenêtre large (depuis 2024-01-01, soit avant la
création du projet en 2025-01) et les 3 `reportTypes` (E/V/P) a renvoyé
**447 rapports** sur tout le compte client — **zéro** rattaché au projet
`024042` (`document.projectMainNumber`). Combiné au round 1 (8 contrats déjà
tous identifiés, aucun 9ᵉ document, aucune offre) : **la ligne régie
(2734.80 CHF) n'a pas d'équivalent documentaire dans Volta accessible via
cette API**, ni comme contrat, ni comme offre, ni comme rapport, sur
l'intégralité de la durée du chantier. Conclusion : à traiter autrement —
soit c'est un document Volta d'un type non couvert par ces 3 endpoints
(hors périmètre API v2/v3 exposé), soit ce n'a jamais été saisi dans Volta
(facturé/négocié directement, hors système).

### Résultat facturation réelle — introuvable via l'API, confirmé négatif

`GET /v2/documents?documentNumber=6153` (le document du contrat "adjugé")
renvoie `type: "VERTRAG_NPK"`, `invoiceNumber: null`, `active: false` — donc
strictement aucune facture Volta rattachée à ce contrat au moment du test,
cohérent avec `invoiced: false` déjà vu sur `/v2/contracts` pour les 8
contrats. Or OHM-FLOW enregistre déjà 149 734.80 CHF d'acomptes encaissés.
**Conclusion : la facturation réelle ne transite pas par ces documents
Volta** (ou pas encore au moment du test) — l'API n'expose par ailleurs
aucun endpoint pour lister les factures d'un projet en masse
(`/v2/documents` et `/v2/documents/invoice-amount` ne cherchent que par
numéro de document/facture individuel, qu'il faudrait déjà connaître) :
**introuvable via l'API en l'état, à traiter autrement** (import manuel,
ou confirmation avec le client que ces acomptes sont hors-Volta).

### Mapping mis à jour — les 4 catégories (⚠️ régie et facturation corrigées en Round 3, voir plus bas)

| Catégorie `chantier_financier` | Statut Volta (round 2) | Détail |
|---|---|---|
| **Adjugé** (`ca_lignes` "adjugé", 145 750.05 CHF / 1052 h) | **Confirmé** | `ContractOutDto.totalAmountExclVat` du contrat principal `6153`, match exact ; heures ≈ `workH + technicalElaborationH` (1052.40 vs 1052, écart 0.4h) |
| **PV clients** (`ca_lignes` "PV clients", 32 986.85 CHF) | **Confirmé** | Somme exacte des `totalAmountExclVat` des 7 sous-contrats "Baïta - Appartement X" du même projet |
| **Régie** (`ca_lignes` "travaux en régie", 2 734.80 CHF) | ~~Introuvable via l'API~~ **CORRIGÉ EN ROUND 3 : trouvée** | La recherche round 2 (contrats/offres/rapports) était exhaustive mais cherchait au mauvais endroit — la régie est une **facture** (`RECHNUNG_NPK`), pas un contrat/offre/rapport. Voir Round 3. |
| **Facturation réelle** (`acomptes`, 149 734.80 CHF encaissés) | ~~Introuvable via l'API~~ **NUANCÉ EN ROUND 3 : mécanisme fonctionnel, 1/3 confirmé** | `/v2/documents?invoiceNumber=X` retrouve bien une facture si on connaît X (prouvé avec la régie) — mais toujours pas listable par projet. Voir Round 3. |

Le tableau de mapping complet (section ci-dessus, "Tableau de mapping
proposé") a été corrigé pour refléter le Round 3 — voir ce tableau pour le
statut final de chaque champ, pas les deux lignes ci-dessus qui documentent
l'évolution round 2 → round 3 à titre d'historique.

### Panneau de debug temporaire (nouveau)

Pour permettre une comparaison visuelle directe (à l'œil) entre ces données
Volta brutes et le module financier existant, un panneau exploratoire a été
ajouté à l'app — **temporaire, à retirer une fois le mapping définitif
intégré** :

- **Backend** : `GET /api/chantiers/<id>/volta-debug` (admin only, dans
  `backend/app.py`) — sert tel quel `backend/volta_debug_la_baita.json`
  (projet Volta + 8 contrats + résultat de la recherche régie + résultat de
  la vérification facturation), hardcodé sur `chantier_id == 15`. Aucun
  appel live à Volta à chaque requête — juste une lecture de fichier local,
  pour respecter le rate-limit.
- **Frontend** : panneau pliable "🔧 Debug Volta (temporaire)" en bas de
  l'onglet **Finances** du détail chantier (`FinancesTab.tsx`, composant
  `VoltaDebugPanel`), admin only (l'onglet Finances l'est déjà). Affiche le
  JSON pretty-print au clic, sans rafraîchissement automatique.
- **Pour le voir** : se connecter en admin, ouvrir le chantier **id 15**
  ("2600030-Martigny-Baita"), onglet **Finances**, dérouler le bandeau ambre
  tout en bas de la page.
- **Important — le backend n'est pas en bind-mount Docker** (voir
  `Dockerfile`/`docker-compose.yml` : `backend/` et le frontend buildé sont
  copiés dans l'image, pas montés en volume). Le conteneur `web` actuel ne
  reflète donc pas ce nouveau code tant qu'il n'est pas reconstruit — sur
  consigne explicite de ne pas redémarrer l'app pendant cette tâche, **aucun
  rebuild/restart n'a été fait**. Un `docker compose up -d --build` sera
  nécessaire pour voir le panneau apparaître réellement sur localhost:5000.

## Round 3 (2026-09-04, correction) — la régie EST dans Volta, sous forme de facture

**Correction humaine** : la conclusion négative du round 2 sur la régie était
fausse — pas parce que la recherche était mal exécutée sur les endpoints
testés (contrats/offres/rapports), mais parce que ce ne sont **pas les bons
endpoints** pour ce document : la régie de La Baita est une **facture**
Volta (type `RECHNUNG_NPK`), pas un contrat/offre/rapport. Le round 2 ne
cherchait jamais dans les documents/factures par numéro — piste absente.

### Requêtes (5 au total, ciblées — pas de nouveau scan de masse)

| # | Horodatage | Requête | Résultat |
|---|---|---|---|
| 1 | 2026-09-04T11:35:51 | `POST /authenticate` | 200 |
| 2 | 2026-09-04T11:35:52 | `GET /v2/documents/invoice-amount?orgUnitCode=ATE-ATE-1&invoiceNumber=7098` | 200 — `{"amountInclVat":2956.3,"amountExclVat":2734.8}` |
| 3 | 2026-09-04T11:35:52 | `GET /v2/documents?orgUnitCode=ATE-ATE-1&documentNumber=7098` | 200 — mais **mauvais document** (projet 024012, "École de Saxé", sans rapport avec La Baita) |
| 4 | 2026-09-04T13:01:59 | `POST /authenticate` (session précédente coupée par un rate-limit externe, reprise ici) | 200 |
| 5 | 2026-09-04T13:02:00 | `GET /v2/documents?orgUnitCode=ATE-ATE-1&invoiceNumber=7098` (cette fois par `invoiceNumber`, pas `documentNumber`) | 200 — **bon document**, voir ci-dessous |

*(session coupée par un rate-limit après la requête #3 — vérifié avant de reprendre qu'aucune requête n'avait été perdue/dupliquée, voir `scripts/volta_dumps/07_*.json` et `08_*.json` déjà sur disque)*

### Découverte clé : `documentNumber` et `invoiceNumber` sont deux numérotations Volta distinctes

La requête #3 (recherche par `documentNumber=7098`) a semblé fonctionner
(200, un document retourné) mais c'était un **faux positif** : Volta a deux
séquences de numéros indépendantes pour un même document — son
`documentNumber` interne et son `invoiceNumber` (numéro de facture "métier",
celui que les humains utilisent). `documentNumber=7098` correspond par
coïncidence à un tout autre document (une facture pour le projet 024012
"École de Saxé", sans lien avec La Baita). Le vrai document de la facture
régie de La Baita a `documentNumber=8144` et `invoiceNumber=7098` — **il faut
chercher par `invoiceNumber`, pas par `documentNumber`**, pour retrouver une
facture par son numéro "métier".

La requête #2 (`/v2/documents/invoice-amount?invoiceNumber=7098`) avait déjà
donné le bon montant par coïncidence hasardeuse — heureusement, mais
confirmé formellement seulement par la requête #5 qui relie ce montant au
bon document/projet :

```json
{
  "orgUnitCode": "ATE-ATE-1",
  "projectNumber": "024042.001",
  "projectMainNumber": 24042,
  "type": "RECHNUNG_NPK",
  "title": "Facture",
  "description": "Immeuble la Baïta",
  "documentNumber": "8144",
  "invoiceNumber": 7098,
  "invoiceAddress": "OTTAN Immobilier SA, p.a Debons Architectures SA, ...",
  "active": false
}
```

**Régie CONFIRMÉE** : facture Volta n° **7098** (documentNumber interne
8144), type `RECHNUNG_NPK`, projet `024042.001` (La Baita) — `amountExclVat`
= **2734.80 CHF**, match exact avec la ligne CA "travaux en régie" et avec
l'acompte OHM-FLOW "regie 1".

### Facturation réelle globale (149 734.80 CHF) — mécanisme confirmé fonctionnel, mais toujours pas listable par projet

La bonne nouvelle : l'endpoint `/v2/documents` (recherche par `invoiceNumber`)
**fonctionne** et permet de retrouver une facture Volta complète (montant,
projet, description) à partir de son numéro — la conclusion "introuvable via
l'API" du round 2 était donc trop pessimiste pour la régie, qui avait
simplement un numéro qu'on ne connaissait pas encore.

Mais ceci ne change pas la conclusion structurelle pour le **reste** de la
facturation réelle (les 2 acomptes restants, 117 600 + 29 400 CHF) : on ne
connaît **aucun numéro de facture Volta** pour eux, et `DocumentSearchRequest`
(`/v2/documents`) n'accepte toujours que `documentNumber` / `invoiceNumber` /
`externalDocumentId` — **aucun paramètre de type `projectNumber`** pour
lister toutes les factures d'un projet. Sans un numéro de facture connu à
l'avance (obtenu autrement — export compta, PDF de facture, etc.), il n'y a
pas de requête à faire ici : deviner/scanner des plages de numéros aurait été
un nouveau scan de masse, explicitement hors budget de cette passe.

**Conclusion mise à jour** : la facturation réelle **existe bel et bien dans
Volta et est vérifiable par l'API si on connaît le numéro de facture**
(mécanisme confirmé avec la régie) — mais reste **non listable par projet**,
donc les 2 acomptes restants ne peuvent pas être confirmés sans une donnée
d'entrée supplémentaire (leur numéro de facture Volta).

## Questions ouvertes

1. **Ligne régie (2 734.80 CHF) — RÉPONDU, CORRIGÉ EN ROUND 3 : trouvée.**
   Facture Volta n° 7098 (documentNumber interne 8144), type `RECHNUNG_NPK`,
   projet 024042.001, montant exact 2734.80 CHF. Le round 2 avait conclu à
   tort "introuvable" en ne cherchant que dans contrats/offres/rapports —
   une facture est un type de document séparé, trouvable seulement en
   cherchant `/v2/documents` par son `invoiceNumber`. Voir Round 3 ci-dessus.
2. **CA réel / acomptes — NUANCÉ EN ROUND 3 : mécanisme confirmé, 2/3 encore
   non vérifiés faute de numéro connu.** Le round 2 avait conclu à tort que
   la facturation réelle était structurellement absente de l'API — en fait
   `/v2/documents?invoiceNumber=X` la retrouve très bien (prouvé avec la
   régie). Ce qui reste vrai : aucun paramètre ne permet de lister les
   factures d'un projet (seulement par numéro déjà connu), donc les 2
   acomptes restants (117 600 + 29 400 CHF) ne sont vérifiables que si on
   obtient leurs numéros de facture Volta par un autre moyen (export
   compta, PDF de facture) — pas par une recherche API.
3. **Achats matériel réels** et **heures réellement pointées** : aucune
   piste confirmée dans le périmètre exploré (`/v2/wholesalers`,
   licences, ou un module de pointage horaire séparé, à investiguer).
4. **`taux_horaire`** : pas de champ direct vu dans les schémas explorés
   (`Project`, `ContractOutDto`). Peut-être une donnée de configuration
   client-account (`/v2/client-accounts/configuration`) ou un tarif catalogue
   (`/v2/catalogs/simple`) — non testé.
5. **Signification exacte de `reportType` E/V/P** : non documentée dans le
   spec OpenAPI (pas de description sur l'enum) — à demander au support
   Volta si cette info devient nécessaire à un mapping réel.
6. **Écart de 4% sur `charge_materiel_prevue`** vs `materialCHF` du contrat
   principal : à clarifier avec l'utilisateur métier (correction manuelle
   assumée, ou bug de calcul à identifier).

## Prochaine étape (hors périmètre de cette tâche)

Aucune intégration réelle n'a été commencée (seul le panneau de debug — un
affichage brut, pas une synchronisation — a été ajouté sur demande
explicite). Une future itération pourrait, à raison de quelques requêtes
espacées par session : (a) explorer `/v2/catalogs/simple` /
`/v2/client-accounts/configuration` pour le taux horaire, (b) obtenir
auprès du client/de la compta les 2 numéros de facture Volta restants
(pour les acomptes 117 600 et 29 400 CHF) puis les vérifier via
`/v2/documents?invoiceNumber=X` exactement comme pour la régie, avant
d'envisager une synchronisation réelle. Le panneau `VoltaDebugPanel` /
`GET /api/chantiers/<id>/volta-debug` est à retirer à ce moment-là (code
marqué "TEMPORAIRE" des deux côtés pour qu'il soit facile à repérer).
