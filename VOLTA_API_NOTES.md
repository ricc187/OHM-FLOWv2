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
  les rapports remontés par `/v2/reports` (aucun rapport sur le projet 24042
  dans le lot retourné). Reste à confirmer — voir Questions ouvertes.

## Réponse à la question : adjugé / régie / PV clients, documents séparés ou fusionnés côté Volta ?

**Séparés.** Ce ne sont pas trois champs d'un même document Volta, ni un
sous-total interne à un seul contrat : ce sont **des documents Volta
distincts** (des "Contrat" au sens Volta), chacun avec son propre
`documentNr`, sa propre description, ses propres `sums`. Le champ
`chantier_financier`/`CaLignePrevue` (liste à taille libre chez nous) est en
réalité une **agrégation manuelle côté OHM-FLOW** de plusieurs documents
Volta réels :
- 1 contrat "chantier" = ligne adjugé,
- N contrats "par appartement" = lignes PV clients (autant de lignes que de
  copropriétaires facturés séparément),
- (probablement) des rapports de régie facturés séparément = ligne régie —
  non confirmé dans le lot de rapports récupéré.

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
| `CaLignePrevue.montant` (ligne "régie") | Non confirmé — piste : rapports (`/v2/reports`, `reportType`) facturés via un contrat séparé, ou via `PUT /v2/reports/billable` + `documents/invoice-amount` | **Basse / à confirmer** |
| `charge_materiel_prevue` (66 824 CHF) | Proche mais **pas égal** à `ContractOutDto.sums.materialCHF` du contrat principal (64 201.75 CHF, écart ≈ 2 622 CHF / 4%) | **Moyenne** — probablement une valeur corrigée manuellement (le fichier Excel de référence s'appelle "modèle corrigé"), pas un miroir live du contrat |
| `taux_horaire` (71 CHF/h) | Aucun champ direct trouvé dans `Project`/`ContractOutDto`. Piste non explorée (budget requêtes épuisé) : `/v2/catalogs/simple`, `/v2/employees`, ou configuration client-account | **Aucune trouvée** |
| `Acompte` (montants réellement encaissés/facturés, CA réel) | Aucun des 8 contrats n'a `invoiced=true` malgré des acomptes bien réels côté OHM-FLOW (149 734.80 CHF) → la facturation réelle vit ailleurs dans Volta (`/v2/documents`, `/v2/documents/invoice-amount`, factures), pas dans `/v2/contracts` | **Aucune confirmée** — piste identifiée, pas testée |
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

## Questions ouvertes

1. **Ligne régie (2 734.80 CHF)** : ni dans les 8 contrats du projet, ni dans
   le lot de rapports retourné par `/v2/reports` (qui ne couvrait pas le
   projet 24042). À investiguer avec 1-2 requêtes supplémentaires, plus tard
   (hors budget de cette session) : `/v2/reports?reportTypes=E,V,P` avec un
   `modifiedAfter` plus ancien pour couvrir toute la durée du chantier
   (2025-03 à 2026-08), ou `/v1/{orgUnitCode}/reports`.
2. **CA réel / acomptes** : aucun des 8 contrats n'a `invoiced=true`, alors
   que 149 734.80 CHF ont bien été encaissés côté OHM-FLOW. La facturation
   réelle vit probablement dans `/v2/documents` (avec un filtre par type
   facture) ou `/v2/documents/invoice-amount` — non testé.
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

Aucune intégration n'a été commencée — cette passe s'arrête au mapping
proposé, conformément à la consigne. Une future itération pourrait, à raison
de quelques requêtes espacées par session : (a) confirmer la ligne régie et
la facturation réelle via `/v2/documents`, (b) explorer `/v2/catalogs/simple`
pour le taux horaire, avant d'envisager une synchronisation réelle.
