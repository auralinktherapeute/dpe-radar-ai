# Modele de scoring — Intention de vente

## 1. Definition exacte de ce qu'on predit

> **Cible :** probabilite qu'un bien donne fasse l'objet d'une **mise en vente observable**
> (publication d'annonce ou mutation DVF) dans une fenetre de **12 mois** a compter de la
> date de calcul.

Cette definition a trois proprietes qui comptent :

1. Elle est **observable a posteriori** sur des donnees publiques → le modele est
   backtestable et calibrable sans aucun client.
2. Elle porte sur un **bien**, pas sur une personne.
3. Elle est **falsifiable** — on peut avoir tort et le mesurer.

Le score affiche (0-100) n'est **pas** une probabilite brute : c'est un rang calibre. Un
score de 80 signifie « dans le top des biens de ce secteur selon les signaux disponibles »,
pas « 80 % de chances de vendre ». Cette distinction est ecrite dans l'UI, parce qu'un
negociateur qui croit lire une probabilite perd confiance des le premier faux positif.

## 2. Catalogue des signaux (liste blanche)

Aucun signal hors de cette table ne peut entrer dans le score. La liste blanche est un
garde-fou de conformite autant qu'un choix de modelisation.

| Id | Signal | Source | Poids v1 | Intuition metier |
|---|---|---|---|---|
| `DPE_RECENCY` | Anciennete du DPE | ADEME | **30** | Le DPE est obligatoire pour vendre. Un DPE frais precede souvent l'annonce. |
| `DPE_CLASS_PRESSURE` | Classe energetique | ADEME | **15** | G interdit a la location depuis 2025, F en 2028 : le bailleur arbitre entre travaux et vente. |
| `NO_ACTIVE_LISTING` | Absence d'annonce active | Pige | **12** | Si l'annonce existe deja, ce n'est plus une opportunite amont mais de la pige classique. |
| `HOLDING_DURATION` | Duree de detention estimee | DVF | **12** | La probabilite de revente culmine vers 8-12 ans de detention. |
| `MARKET_VELOCITY` | Acceleration des ventes du quartier | DVF | **10** | Un marche qui s'anime declenche des decisions de vente. |
| `PRICE_MOMENTUM` | Momentum du prix/m2 | DVF | **8** | Une hausse locale cristallise la plus-value. |
| `LISTING_PRICE_DROP` | Baisse de prix constatee | Pige | **8** | Mandat concurrent en difficulte : fenetre de re-mandatement. |
| `ENERGY_GAP` | Ecart au DPE median du quartier | ADEME | **5** | Un bien nettement moins performant que son quartier se vend mal sans travaux. |

**Total = 100.** Les poids v1 sont des priors experts, destines a etre remplaces par des
coefficients appris (section 6). Ils sont declares dans un seul fichier versionne
(`src/domain/scoring/signals/weights.ts`) et le numero de version du bareme est stocke avec
chaque score — un score n'est interpretable que si l'on sait avec quel bareme il a ete calcule.

## 3. Fonctions de normalisation

Chaque signal produit une valeur dans `[0,1]`. Les courbes sont choisies pour etre
**monotones et lisibles** : un negociateur doit pouvoir comprendre pourquoi le score bouge.

### `DPE_RECENCY` — decroissance par paliers

| Age du DPE | Valeur |
|---|---|
| 0-3 mois | 1.00 |
| 3-6 mois | 0.85 |
| 6-12 mois | 0.60 |
| 12-18 mois | 0.30 |
| > 18 mois | 0.05 |

Paliers plutot que courbe continue : le metier raisonne en « DPE du trimestre », pas en jours.

### `HOLDING_DURATION` — cloche centree sur 9 ans

```
v(t) = exp( -((t - 9)^2) / (2 * 4.5^2) )      pour t >= 2 ans
v(t) = 0.05                                    pour t < 2 ans
```

Le plancher sous 2 ans traduit un fait de marche : entre frais de notaire et fiscalite de
la plus-value, une revente immediate est rare.

### `DPE_CLASS_PRESSURE` — table de pression reglementaire

| Classe | G | F | E | D | C | B | A |
|---|---|---|---|---|---|---|---|
| Valeur | 1.00 | 0.85 | 0.45 | 0.20 | 0.10 | 0.05 | 0.05 |

Le decrochage E -> F traduit le calendrier d'interdiction de location.

### `MARKET_VELOCITY` — ratio de volumes glissants

```
ratio = ventes(12 derniers mois) / ventes(12 mois precedents)
v     = clamp( (ratio - 0.90) / 0.40 , 0, 1 )
```
Un ratio de 1.30 (+30 % de transactions) sature le signal.

### `PRICE_MOMENTUM` — variation du prix/m2 sur 12 mois

```
v = clamp( (delta + 0.05) / 0.15 , 0, 1 )
```
-5 % annule le signal, +10 % le sature.

### Signaux binaires / bornes
- `NO_ACTIVE_LISTING` : 1.0 si aucune annonce active detectee, 0.0 sinon.
- `LISTING_PRICE_DROP` : `clamp(baisse_relative / 0.10, 0, 1)`, 0 si pas d'annonce.
- `ENERGY_GAP` : `clamp(|rang_classe_bien - rang_median_quartier| / 3, 0, 1)`.

## 4. Agregation

```
brut  = SIGMA ( valeur_i * poids_i )   sur les signaux DISPONIBLES
masse = SIGMA ( poids_i )              sur les signaux DISPONIBLES
score = round( 100 * brut / masse )
```

**Renormalisation sur la masse disponible**, et non sur 100. Un bien pour lequel on n'a que
le DPE ne doit pas etre penalise a 45/100 par simple absence de donnees DVF — il doit etre
score sur ce qu'on sait, avec une **confiance plus basse**. C'est la confiance qui porte
l'incertitude, pas le score. Confondre les deux est l'erreur classique de ce type d'outil.

## 5. Indice de confiance

```
couverture = masse_disponible / 100
fraicheur  = clamp( 1 - (age_max_donnees_en_jours / 540), 0, 1 )
geo        = { adresse exacte: 1.0 | rue: 0.6 | commune: 0.2 }

confiance  = round( 100 * (0.50*couverture + 0.25*fraicheur + 0.25*geo) )
```

### Regles d'affichage imposees par la confiance

| Confiance | Comportement produit |
|---|---|
| >= 70 | Score exact affiche, bien ciblable |
| 40-69 | Score exact + bandeau « donnees partielles » |
| < 40 | **Aucun score chiffre.** Fourchette large + « donnees insuffisantes » |
| geo < 0.5 | Bien **non ciblable par courrier** (on ne sait pas ou l'envoyer) — exclu des exports |

Ces regles sont dans le domaine, pas dans l'UI : elles s'appliquent aussi a l'API et aux
exports CSV.

## 6. Explicabilite

Pour chaque bien, le systeme renvoie les contributions triees par **points de score
apportes** :

```
contribution_i = (valeur_i * poids_i / masse) * 100
```

Chaque raison porte : libelle metier, valeur brute, **source** (ADEME / DVF / pige), **date
de la donnee**, et contribution en points. Exemple de sortie :

> **Score 78** · confiance 74
> 1. DPE realise il y a 2 mois — +28 pts *(ADEME, 12/06/2026)*
> 2. Aucune annonce active detectee — +12 pts *(pige, 20/08/2026)*
> 3. Detention estimee 10 ans — +11 pts *(DVF, mutation 03/2016)*
> 4. Ventes du quartier +22 % sur 12 mois — +7 pts *(DVF, 2025-2026)*
> 5. Classe E — +6 pts *(ADEME, 12/06/2026)*

La date est obligatoire dans chaque raison. Un negociateur qui cite une donnee sans savoir
de quand elle date se decredibilise en rendez-vous.

## 7. Calibration — le vrai travail

### Protocole de backtest (realisable sans aucun client)

1. Se placer a une date d'observation `T0` = aujourd'hui - 18 mois.
2. Constituer l'univers : tous les biens avec DPE connu a `T0` sur des secteurs temoins
   (proposer 3 typologies : metropole tendue, ville moyenne, rural).
3. Calculer le score avec les seules donnees disponibles **a `T0`** (rigueur anti-fuite :
   aucune donnee posterieure ne doit entrer, y compris les agregats de quartier).
4. Label = 1 si mutation DVF ou annonce observee entre `T0` et `T0 + 12 mois`.
5. Mesurer.

### Metriques et seuils d'acceptation

| Metrique | Seuil minimal pour commercialiser |
|---|---|
| **Lift au decile superieur** | >= 2.5x le taux de base du secteur |
| **AUC** | >= 0.68 |
| **Brier score** | < taux de base (modele mieux que constant) |
| **Stabilite inter-secteurs** | Lift >= 2.0x sur les 3 typologies |

Le lift au decile est la metrique commerciale : « sur les 100 biens que l'outil vous met en
tete de liste, 2,5 fois plus se mettent en vente que si vous aviez tire au hasard dans le
secteur ». C'est la phrase qui vend, et elle doit etre vraie.

**Si le lift est < 2.0x, le produit ne doit pas etre commercialise en l'etat.** Cette regle
est ecrite ici pour engager les decisions futures, y compris quand elles seront couteuses.

### v2 — modele appris

Regression logistique regularisee (L2) sur les memes signaux, avec **contrainte de
monotonie** par signal. Pourquoi pas un gradient boosting : l'explicabilite par
contributions additives est une exigence produit *et* un argument de conformite (le
profilage doit pouvoir etre explique a la personne concernee). Un modele lineaire calibre
vaut mieux ici qu'un modele opaque legerement plus performant.

Re-entrainement trimestriel, avec **score de derive** (PSI) sur chaque signal et alerte si
la distribution bouge.

## 8. Anti-patterns explicitement ecartes

- **Pas de score fabrique quand la donnee manque.** Absence -> confiance basse, pas
  imputation silencieuse par la moyenne.
- **Pas de signal socio-demographique** (revenu median du quartier, composition des
  menages). Tentant, corrélé — et porte de sortie vers de la discrimination indirecte.
- **Pas de boucle auto-realisatrice non tracee** : si une agence contacte un bien et le
  rentre en mandat, ce mandat ne doit pas etre compte comme une reussite de prediction sans
  marquage. Sinon le modele apprend son propre biais d'action.
