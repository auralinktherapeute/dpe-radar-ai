# DPE Radar AI — Vision produit

> Copilote IA de detection precoce d'opportunites de mandat, pour les agences immobilieres francaises.

## 1. Le probleme

Une agence signe un mandat quand elle arrive **avant** les autres. Aujourd'hui elle arrive
apres : la pige classique (SeLoger, LBC, Bien'ici) ne se declenche qu'une fois l'annonce
publiee. A ce moment-la, le vendeur a deja choisi son camp — 3 a 6 agences l'ont appele
dans l'heure, ou il est parti en PAP.

Le temps utile se situe **en amont de l'annonce** : entre le moment ou un proprietaire
commence a preparer sa vente et le moment ou il la publie. Cette fenetre dure typiquement
2 a 6 mois, et elle laisse des traces dans des donnees publiques.

## 2. L'insight

**Un DPE ne se fait pas par hasard.** Le DPE est obligatoire pour vendre et pour louer.
Un diagnostic realise sur un logement occupe par son proprietaire, hors contexte locatif,
est l'un des rares signaux *anterieurs a l'annonce* qui soit a la fois public, date, et
localise a l'adresse.

L'ADEME publie ces diagnostics en open data (licence Etalab 2.0, ~12 M de DPE, mise a jour
mensuelle pour l'existant, quotidienne cote flux). Croises avec les mutations DVF, les
prix de quartier et l'absence d'annonce active, ils dessinent une probabilite d'intention
de vente.

## 3. Ce que le produit est — et ce qu'il n'est pas

| DPE Radar AI **est** | DPE Radar AI **n'est pas** |
|---|---|
| Un score de probabilite d'intention de vente, sur un **bien** | Une liste de vendeurs |
| Une aide a la priorisation du terrain | Un fichier de prospection telephonique |
| Explicable : 3 a 5 raisons sourcees et datees par bien | Une boite noire |
| Un copilote qui prepare l'approche | Un automate qui contacte a votre place |
| Conforme par construction (garde-fous dans le code) | Un outil qui vous laisse vous debrouiller avec le RGPD |

**Regle produit non negociable :** l'outil ne dit jamais « ce bien est a vendre ». Il dit
« ce bien presente N signaux compatibles avec une preparation de vente, avec tel niveau de
confiance, voici lesquels ». La nuance n'est pas cosmetique : c'est la difference entre un
outil defendable et un outil qui expose l'agence.

## 4. Le score en une phrase

> Un score **0-100** d'intention de vente estimee a 3-12 mois, assorti d'un **indice de
> confiance 0-100** et des **contributions detaillees** de chaque signal, calcule sur un
> bien identifie par son adresse — jamais sur une personne nommee.

Quand la confiance est faible (< 40), le produit **refuse d'afficher un score precis** et
affiche une fourchette. Un chiffre faux presente avec assurance detruit la confiance du
negociateur plus vite qu'une absence de chiffre.

## 5. Utilisateurs

| Persona | Besoin | Metrique qui compte pour lui |
|---|---|---|
| **Directeur d'agence** (acheteur) | Remplir le pipe de mandats, prouver le ROI de l'outil | Mandats signes / mois, cout par mandat |
| **Negociateur** (utilisateur quotidien) | Savoir ou aller ce matin, avec un angle d'accroche | Rendez-vous obtenus / 100 contacts |
| **Responsable reseau** (multi-agences) | Comparer les agences, piloter les secteurs | Taux de couverture du secteur, classement agences |
| **DPO / juridique** (bloqueur) | Ne pas exposer l'enseigne | Tracabilite, registre, droit d'opposition operationnel |

Le DPO est un persona a part entiere. Sur ce marche, c'est lui qui tue les deals — le
produit doit lui livrer un dossier de conformite pret a l'emploi (voir `01-conformite`).

## 6. Boucle de valeur

```
Donnees publiques (ADEME, DVF, BAN)
        v
Signaux normalises + scores expliques
        v
Radar Opportunites : le negociateur sait ou aller aujourd'hui
        v
Approche conforme (courrier adresse / terrain), tracee dans le CRM
        v
Issue observee : RDV, mandat, refus, opposition
        v
Recalibration du modele  ------> retour en haut
```

La derniere fleche est la vraie barriere a l'entree. Un concurrent peut copier les sources
publiques ; il ne peut pas copier 18 mois d'issues observees qui calibrent le modele.

## 7. Ce qui doit etre vrai pour que ca marche

Hypotheses a valider, par ordre de risque decroissant :

1. **H1 (juridique)** — Une agence accepte d'assumer une prospection a l'adresse fondee sur
   des donnees publiques, apres AIPD. *Test : 5 entretiens DPO / avocats avant toute ligne
   de code commerciale.*
2. **H2 (signal)** — Le taux de mise en vente a 12 mois des biens du top decile de score est
   significativement superieur au taux de base du secteur. *Test : backtest sur DVF
   historique, voir `03-modele-de-scoring.md` section Calibration.*
3. **H3 (canal)** — Sans telephone, un courrier adresse + passage terrain convertit assez
   pour justifier l'abonnement. *Test : pilote 3 agences, 90 jours.*
4. **H4 (adoption)** — Le negociateur ouvre l'outil tous les matins. *Test : DAU/MAU > 0,5.*

H2 est testable **des maintenant, sans client**, sur des donnees publiques. C'est le premier
travail d'ingenierie a faire — avant l'UI, avant le CRM, avant Stripe.
