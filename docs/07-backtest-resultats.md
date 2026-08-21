# Backtest de calibration — resultats

> Execute le 20 aout 2026 sur donnees publiques reelles, sans fuite temporelle.
> Reproductible : `npx tsx scripts/backtest.ts <codes INSEE> [--diagnostic]`

## 1. Protocole

| | |
|---|---|
| Date d'observation `T0` | **30/06/2023** |
| Fenetre d'observation | 01/07/2023 → 30/06/2024 (12 mois) |
| Univers | Tous les DPE **maisons** recus avant `T0` dans la commune |
| Signaux | Calcules avec les **seules** donnees disponibles a `T0` |
| Label | 1 si une mutation DVF est observee a l'adresse dans la fenetre |
| Bareme | `v2.0.0-calibre` |

`T0` n'est pas arbitraire : la fenetre d'observation doit etre **entierement
publiee** dans DVF, sinon les labels sont tronques et le modele parait mauvais a tort.

## 2. Resultats par typologie de territoire

| Typologie | Communes | n | Taux de base | AUC | Lift decile 1 | Verdict |
|---|---|---|---|---|---|---|
| **Metropole tendue** | Bordeaux (33063) | 3 880 | 14,36 % | 0,689 | **2,03x** | A retravailler |
| **Ville moyenne** | Limoges, Angouleme | 3 237 | 14,77 % | **0,759** | **2,70x** | **Commercialisable** |
| **Rural** | 10 communes de Dordogne | 1 997 | 12,62 % | 0,723 | **2,26x** | A retravailler |

Seuils declares a l'avance (`docs/03`, s.7) : lift >= 2,5x pour commercialiser,
< 2,0x pour arreter, AUC >= 0,68.

**Lecture :** les trois typologies franchissent le plancher de 2,0x et le seuil
d'AUC. Une seule atteint le seuil de commercialisation. Le modele est
**valide en ville moyenne**, exploitable mais perfectible ailleurs.

## 3. La conclusion qui oriente le go-to-market

Le signal est **nettement plus discriminant en ville moyenne qu'en metropole
tendue** (2,70x contre 2,03x). L'explication tient au marche : dans une
metropole ou tout se vend, un score separe mal ; dans une ville moyenne, le
diagnostic recent distingue reellement.

**Consequence commerciale : ouvrir sur les villes moyennes, pas sur
Bordeaux, Lyon ou Paris.** C'est l'inverse de l'intuition — et c'est ce que
disent les donnees.

## 4. Ce que le backtest a corrige dans le modele

### a) Un artefact de construction d'univers

Premier passage : taux de base **21,5 %**, AUC **0,430**, lift inverse. Deux
causes, toutes deux methodologiques :

1. **Le label a l'adresse est invalide pour les appartements.** Un immeuble de
   vingt logements connait presque toujours une mutation dans l'annee : le label
   mesurait la taille de l'immeuble, pas l'intention d'un proprietaire. L'univers
   est desormais restreint aux **maisons**, ou l'adresse correspond au logement.
2. **L'univers etait tronque sur la fraicheur.** Le filtre de type s'appliquait
   apres la requete : sur 36 099 DPE anterieurs a `T0` a Bordeaux, seuls les
   15 000 plus recents etaient charges — ce qui supprimait toute variance sur
   le signal dominant. Le filtre est passe cote API.

Apres correction : taux de base 14,4 %, AUC 0,689, courbe de deciles
proprement decroissante.

### b) Trois priors confrontes a la mesure

Diagnostic par signal (Bordeaux, `--diagnostic`, taux de base 14,9 %) :

| Signal | Mesure | Verdict |
|---|---|---|
| DPE 0-3 mois | **1,82x** | Confirme, plus fort que prevu |
| DPE 3-6 mois | 1,78x | Confirme |
| DPE 6-12 mois | 0,77x | **Effondrement** — la v1 lissait a 0,60 |
| DPE > 18 mois | 0,33x | Confirme |
| Classe A-B | 1,13x | — |
| Classe E / F | 1,11x / 1,15x | Effet marginal |
| **Classe G** | **0,69x** | **Refute** : sous le taux de base |
| Detention < 2 ans | 0,63x | Confirme le plancher |
| Detention 2-7 ans | 1,44x | Confirme la montee |

**La these « passoire thermique = vendeur » n'est pas confirmee.** Les classes
F et G ne se vendent pas plus que les autres ; G se vend meme moins. Le poids
de `DPE_CLASS_PRESSURE` passe de 15 a 5, conserve au titre du calendrier
reglementaire (interdiction de location F en 2028), **pas** de la preuve.

Le poids de `DPE_RECENCY` passe de 30 a 45 : c'est lui qui porte le signal.

### c) Une limite d'observabilite du signal de detention

`geo-dvf` ne publie que **2021-2025**. Une detention de plus de ~4 ans n'est
donc pas observable : la cloche centree sur 9 ans reste un **prior non
verifiable** avec les donnees publiques. Le poids du signal est reduit a 8, et
la fonction ne descend plus sous son plancher au-dela du pic.

### d) Un defaut de la formule de confiance

Avec un signal a 45 points, un bien connu par son **seul DPE** atteignait 71 de
confiance — presque le seuil « fiable » sur une unique observation. La
ponderation est passee de `0,5 / 0,25 / 0,25` a **`0,6 / 0,2 / 0,2`**
(couverture / fraicheur / geocodage). Le plafond hors DVF passe de 85 a 84.

## 5. Limites a garder en tete

- **Le signal de pige est absent du backtest.** `NO_ACTIVE_LISTING` (12 points)
  n'a pas de donnee historique : le top decile mesure ici contient des biens
  **deja en vente a `T0`**, que le produit exclurait. Les chiffres sont donc un
  **minorant** de la performance sur l'objectif reel — trouver les biens *avant*
  l'annonce.
- **Les appartements ne sont pas mesures.** La cible n'y est pas observable avec
  les donnees publiques. Le produit les score, mais leur calibration reste a
  faire par une autre voie (retours d'issue des agences).
- **Une seule fenetre temporelle.** Un marche different (taux, conjoncture)
  pourrait donner d'autres coefficients. La recalibration trimestrielle prevue
  au `docs/02` repond a ce risque.
- **Trois territoires.** Suffisant pour orienter, insuffisant pour generaliser.

## 6. Prochaine etape de modelisation

Passer d'un bareme a coefficients fixes a une **regression logistique
regularisee** apprise sur cet echantillon, avec contrainte de monotonie par
signal — l'explicabilite additive reste une exigence produit et de conformite.
Le pipeline de backtest est en place ; c'est desormais un travail
d'ajustement, plus d'infrastructure.
