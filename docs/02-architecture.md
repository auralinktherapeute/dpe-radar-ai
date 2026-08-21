# Architecture

## 1. Principe : hexagonale, pour une raison precise

Le choix n'est pas stylistique. Le moteur de scoring doit pouvoir etre
**rejoue a l'identique** deux ans apres un calcul, pour deux motifs :

- **juridique** — le RGPD impose de pouvoir expliquer un profilage a la personne
  concernee ;
- **scientifique** — le backtest exige de recalculer des scores a une date passee
  sans qu'aucune donnee posterieure ne fuite dans le calcul.

Ces deux exigences imposent un noyau **pur, deterministe, sans I/O**. Tout le
reste en decoule.

```
                      ┌────────────────────────────┐
   HTTP / cron  ──────▶│   src/interface/           │  Next.js, routes, jobs
                      └─────────────┬──────────────┘
                                    ▼
                      ┌────────────────────────────┐
                      │   src/application/         │  cas d'usage + PORTS
                      │   (orchestration)          │
                      └─────────────┬──────────────┘
                       ▲            ▼            ▲
        implémentent   │  ┌────────────────────┐ │
                       │  │   src/domain/      │ │  PUR — zéro dépendance
                       │  │  scoring, compliance│ │
                       │  └────────────────────┘ │
                      ┌┴─────────────────────────┴┐
                      │   src/infrastructure/     │  ADEME, DVF, BAN, Prisma,
                      │   (adaptateurs)           │  Redis, OpenAI, Stripe
                      └───────────────────────────┘
```

**Regle de dependance :** `domain` n'importe rien. `application` n'importe que
`domain`. `infrastructure` implemente les ports de `application`. `interface`
cable le tout. Aucune signature de port ne laisse fuir un type Prisma, une
reponse HTTP ou une structure ADEME.

## 2. Le domaine

| Module | Role |
|---|---|
| `scoring/signals/normalizers.ts` | Fonctions pures, monotones, signal brut -> `[0,1]` |
| `scoring/signals/weights.ts` | Bareme versionne, invariant somme = 100 |
| `scoring/services/SignalBuilder.ts` | Faits bruts -> observations datees et sourcees |
| `scoring/services/IntentScoringService.ts` | Agregation, confiance, explications |
| `scoring/value-objects/DvfCoverage.ts` | Territoires hors DVF (voir `04-donnees`) |
| `compliance/OutreachPolicy.ts` | Canaux autorises — **decide avant toute generation** |
| `compliance/Article14Notice.ts` | Bloc d'information RGPD, non supprimable |

Deux conventions portent une part disproportionnee de la qualite :

1. **`null` ne vaut pas `0`.** Un signal indisponible est omis ; un signal
   defavorable vaut zero. Confondre les deux fabrique des scores faux avec
   l'apparence de la precision.
2. **Le score porte le fond, la confiance porte l'incertitude.** On ne penalise
   jamais un score parce qu'on manque de donnees ; on baisse la confiance.

## 3. Les ports

Definis dans `src/application/ports/index.ts` :

`Clock` · `DpeSourcePort` · `MarketDataPort` · `ListingSourcePort` ·
`GeocodingPort` · `PropertyRepository` · `ScoreRepository` ·
`SuppressionListPort` · `AuditLogPort` · `OutreachDraftPort`

Chaque port a une implementation reelle et un double en memoire
(`tests/fixtures/fakes.ts`). Les 122 tests tournent sans base de donnees,
sans reseau, en moins d'une seconde.

## 4. Les cas d'usage

| Cas d'usage | Radar | Garantie particuliere |
|---|---|---|
| `SyncDpeBatch` | Radar DPE | Deduplication par numero de DPE ; un enregistrement malforme ne fait pas tomber le batch ; chaque rejet est journalise avec sa cause |
| `ComputeOpportunityScore` | Radar Opportunites | La liste de suppression est verifiee **avant** tout calcul |
| `PrepareOutreach` | Copilote IA | La politique de contact decide **avant** l'appel au modele ; le bloc art. 14 est verifie **apres** generation |

## 5. Flux de donnees

```
  ADEME (horaire, filtre au secteur souscrit)
        │  numero_dpe, etiquette, dates, identifiant_ban, score_ban
        ▼
  SyncDpeBatch ──▶ Property + Dpe        (BAN embarque : ~95 % sans appel geocodeur)
        │
  DVF (trimestriel, chargement en masse)
        │  mutations par commune, jointure exacte BAN <-> DVF
        ▼
  NeighbourhoodStat + derniere mutation a l'adresse
        │
        ▼
  SignalBuilder ──▶ observations datees/sourcees
        │
        ▼
  IntentScoringService ──▶ Score (immuable, estampille du bareme)
        │
        ▼
  Radar Opportunites ──▶ Lead ──▶ PrepareOutreach ──▶ Outreach (preuve conservee)
        │
        ▼
  Issue observee ──▶ recalibration trimestrielle
```

## 6. Cadences

| Job | Frequence | Justification |
|---|---|---|
| Sync ADEME | horaire | ~274 000 receptions/mois au national, soit ~100/h. Filtre au secteur, c'est negligeable. |
| Recalcul des scores | quotidien | La fraicheur du DPE est le premier signal : il bouge tous les jours. |
| Chargement DVF | trimestriel | DVF est un stock publie par vagues semestrielles, pas un flux. |
| Pige annonces | horaire | Une annonce publiee fait basculer le bien hors du Radar amont. |
| Recalibration du modele | trimestrielle | Avec controle de derive (PSI) par signal. |

## 7. Ce qui n'est pas encore construit

Etat au 20 aout 2026 — a lire comme une liste de dettes assumees, pas comme un
inventaire de promesses :

- `ListingSourcePort` n'a **aucune implementation reelle**. Le scraping des
  portails est ecarte (CGU + position CNIL) ; la voie a instruire est un accord
  de flux ou une pige commerciale sous licence.
- Aucune couche `interface/` (Next.js) : le noyau et les adaptateurs de donnees
  passent avant l'ecran.
- `OutreachDraftPort` n'a qu'un double de test — l'adaptateur OpenAI reste a
  ecrire, avec un prompt contraint et une validation de sortie.
- Le backtest de calibration (`docs/03`, s.7) n'est **pas execute**. C'est le
  premier chantier, et il conditionne la commercialisation.
