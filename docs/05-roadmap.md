# Feuille de route

> Reordonnee par rapport au cahier des charges initial. La sequence d'origine
> (Radar DPE -> Annonces -> Quartier -> Opportunites -> Copilote -> CRM...)
> construit l'interface avant d'avoir prouve que le signal existe. Deux risques
> peuvent tuer le produit — la validite du score et la conformite — et aucun des
> deux ne se leve en ecrivant des ecrans.

## Phase 0 — Prouver le signal *(fait en partie, priorite absolue)*

**Question a laquelle il faut repondre :** les biens du decile superieur se
mettent-ils reellement en vente plus souvent que la moyenne du secteur ?

| Livrable | Etat |
|---|---|
| Moteur de scoring pur, teste, versionne | ✅ 260 tests |
| Adaptateur ADEME sur schema reel | ✅ |
| Adaptateur DVF + jointure exacte BAN | ✅ |
| Garde-fous de conformite executables | ✅ |
| **Backtest de calibration** | ✅ **execute, bareme v2 recale** |

**Resultat mesure** (`07-backtest-resultats.md`) : 2,70x en ville moyenne,
2,26x en rural, 2,03x en metropole tendue. AUC de 0,689 a 0,759.

Le seuil de 2,5x est franchi **en ville moyenne uniquement**. Les trois
typologies passent le plancher de 2,0x. Conclusion assumee : **on ouvre sur les
villes moyennes**, on continue a travailler le modele pour la metropole.

## Phase 1 — Lever le risque juridique *(en parallele, sans code)*

- AIPD complete, redigee et opposable.
- Validation par un avocat specialise des quatre points `[A VALIDER]` de
  `01-conformite-et-cadre-legal.md`.
- Contrat de sous-traitance art. 28, ou requalification en responsabilite
  conjointe si le conseil le retient.
- Page publique d'opposition, indexee, fonctionnelle avant le premier courrier.

**Aucun contact reel avant la fin de cette phase.** Pas un seul.

## Phase 2 — Rendre le signal utilisable

- Persistance Prisma + PostGIS, chargement DVF trimestriel en masse.
- Radar Opportunites : liste triee par secteur, filtres, carte Mapbox.
- Fiche bien : score, confiance, raisons datees et sourcees, canaux autorises.
- **Resolution de la pige** — le trou beant de l'architecture actuelle
  (`04-donnees-et-sources.md`, s.5). Sans elle, le Radar propose des biens deja
  en vente ailleurs.

## Phase 3 — Faire agir le negociateur

- Copilote : courrier conforme, plan de secteur, argumentaire d'entretien.
- CRM pipeline : `A_QUALIFIER -> CONTACTE -> RDV -> ESTIMATION -> MANDAT`.
- Saisie de l'issue observee — c'est la matiere premiere de la recalibration.
- Liste de suppression operationnelle, multi-agences.

## Phase 4 — Boucler la boucle

- Recalibration trimestrielle sur les issues observees.
- Modele appris (logistique regularisee, contrainte de monotonie).
- Detection de derive (PSI) par signal.
- Tableau de bord agence et negociateur.

## Phase 5 — Echelle

- Multi-agences et reseaux, administration, facturation par siege.
- Connecteurs CRM (Apimo, Hektor, Netty).
- Alertes temps reel.
- API ouverte.
- Application mobile.

## Ce qui a change par rapport au cahier des charges

| Point initial | Devenu | Raison |
|---|---|---|
| Radar Annonces en phase 2 | Reporte, non resolu | Le scraping est ecarte ; il faut un accord de flux |
| Copilote genere emails et SMS | Verrouille aux contacts a base legale | Loi du 11/08/2026 et art. L34-5 CPCE |
| Scripts d'appels conformes | Canal telephone supprime du produit | Consentement prealable exprès obligatoire |
| Couverture nationale implicite | Alsace-Moselle et Mayotte degradees | DVF n'y publie rien (livre foncier) |
| Interface d'abord | Backtest d'abord | Un bel ecran sur un score faux ne se rattrape pas |
