# Cahier des Charges Fonctionnel — DPE Radar AI

> **Version** : 1.0  
> **Date** : 21 août 2026  
> **Auteur** : Équipe Produit DPE Radar AI  
> **Destinataires** : Équipe de développement, UX/UI, QA, Compliance  
> **Statut** : Approuvé pour développement

---

## Table des matières

1. [Vision & Objectifs](#1-vision--objectifs)
2. [Personas & Parcours](#2-personas--parcours)
3. [Module Radar DPE](#3-module-radar-dpe)
4. [Module Radar Annonces](#4-module-radar-annonces)
5. [Module Radar Quartier](#5-module-radar-quartier)
6. [Module Radar Opportunités](#6-module-radar-opportunités)
7. [Module Copilote IA](#7-module-copilote-ia)
8. [Module CRM Intégré](#8-module-crm-intégré)
9. [Module Alertes & Notifications](#9-module-alertes--notifications)
10. [Module Administration Multi-Agences](#10-module-administration-multi-agences)
11. [Module Dashboard KPI](#11-module-dashboard-kpi)
12. [Conformité RGPD & Légal](#12-conformité-rgpd--légal)
13. [Annexes](#13-annexes)

---

## 1. Vision & Objectifs

### 1.1 Énoncé du problème
Les agences immobilières perdent des mandats parce qu'elles contactent les vendeurs **trop tard**, lorsque ceux-ci ont déjà publié leur annonce sur SeLoger, LeBonCoin ou MeilleursAgents. À ce stade, la concurrence est maximale (5 à 15 agences en lice) et les commissions sont compressées.

### 1.2 Solution proposée
**DPE Radar AI** est un copilote IA qui analyse les données publiques (DPE ADEME, DVF, annonces) pour identifier, **avant qu'ils ne se manifestent**, les propriétaires ayant une forte probabilité de vendre dans les 3–12 mois. L'outil ne prédit pas la vente : il calcule un **score de probabilité d'intention de vente** (0–100) avec un indice de confiance et les raisons explicites du score.

### 1.3 Objectifs business mesurables

| Objectif | KPI | Cible S6 |
|----------|-----|----------|
| Réduire le time-to-opportunity | Jours entre détection DPE F/G et premier contact agent | < 7 jours |
| Augmenter le taux de conversion | % de scores > 70 convertis en mandat sous 90j | > 12% |
| Réduire le coût d'acquisition | Coût par mandat signé via prospection prédictive | < 800€ |
| Améliorer la productivité | Nombre de contacts qualifiés / semaine / négociateur | > 15 |
| Conformité | 0 plainte CNIL / 0 sanction DGCCRF | 0 |

---

## 2. Personas & Parcours

### 2.1 Persona 1 : Julie, Négociatrice Indépendante (35 ans)

> *"Je passe 4h/jour à faire du porte-à-porte et du démarchage. J'aimerais savoir où frapper avant les autres."*

**Profil** : 5 ans d'expérience, agence de 3 personnes à Lyon 6ème, 12 mandats actifs.  
**Frustrations** : Manque de visibilité sur les biens F/G, temps perdu à qualifier des leads froids, concurrence des grandes enseignes.  
**Besoins** : Liste priorisée de biens à contacter, arguments personnalisés, suivi simple.

**Parcours type** :
1. Julie se connecte le lundi matin → Dashboard avec 8 nouvelles opportunités
2. Elle filtre par score > 70 + DPE F/G + rayon 2km
3. Elle clique sur un bien → voit le score (82), les 3 raisons, la carte du quartier
4. Elle demande au Copilote IA un email personnalisé → relit, modifie, envoie
5. Le propriétaire répond → Julie crée un rendez-vous dans le pipeline
6. 3 semaines plus tard → mandat signé

### 2.2 Persona 2 : Marc, Directeur de Réseau (48 ans)

> *"Je veux que mes 40 négociateurs aient les mêmes outils que les grandes enseignes, mais avec notre marque."*

**Profil** : Dirige un réseau de 4 agences (160 négociateurs), région PACA.  
**Frustrations** : Difficulté à standardiser la prospection, manque de visibilité sur les performances, coût des outils fragmentés.  
**Besoins** : Dashboard réseau, comparaison inter-agences, API pour synchroniser avec le CRM groupe, white-label.

**Parcours type** :
1. Marc accède au tableau de bord réseau → KPI par agence (mandats, scores moyens, activité)
2. Il identifie que l'agence de Marseille sous-performe en détection DPE
3. Il ajuste les alertes réseau pour forcer la priorisation des DPE G
4. Il exporte les données via API vers son CRM interne

### 2.3 Persona 3 : Karim, Responsable Conformité

> *"Chaque contact doit être justifiable légalement. Je veux un audit trail complet."*

**Profil** : Juriste au sein d'un réseau de 20 agences.  
**Besoins** : Traçabilité RGPD, preuve de la base légale, gestion des opt-out, rapports de conformité.

---

## 3. Module Radar DPE

### 3.1 Description
Module de synchronisation, visualisation et filtrage des diagnostics de performance énergétique (DPE) publiés par l'ADEME. C'est le premier signal de détection.

### 3.2 User Stories

#### US-DPE-001 : Synchronisation horaire ADEME
**En tant qu'** administrateur système,  
**Je veux** que les nouveaux DPE soient importés automatiquement toutes les heures,  
**Afin de** disposer des données les plus fraîches possible.

**Critères d'acceptation** :
- [ ] Un job cron s'exécute toutes les heures (minute 0)
- [ ] Seuls les DPE créés depuis la dernière sync sont récupérés
- [ ] Les DPE sont géocodés (lat/lng) via API BAN
- [ ] Les doublons (même adresse + surface + date) sont éliminés
- [ ] Un log d'audit est créé : `DPE_SYNC_COMPLETED`, nombre de nouveaux DPE
- [ ] En cas d'erreur ADEME, 3 retries exponentiels puis alerte Slack/Email admin

**Maquette textuelle** :
```
┌─────────────────────────────────────────────────────────────┐
│  RADAR DPE                                    [⚙️ Paramètres]
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  📊 14 832 DPE indexés    🆕 +127 aujourd'hui    🔄 Sync il y a 23 min
│                                                             │
│  [🔍 Rechercher une adresse...]    [📍 Rayon: 5km ▼]        │
│                                                             │
│  Filtres:  [☑️ A] [☑️ B] [☑️ C] [☑️ D] [☑️ E] [☑️ F] [☑️ G]  │
│            [Surface min: ___] [Année constr: ___]            │
│            [📅 DPE des 30 derniers jours ▼]                  │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐     │
│  │ 🗺️ CARTE (Mapbox)                                   │     │
│  │   • Cercles colorés par classe DPE                   │     │
│  │   • Clustering au zoom out                           │     │
│  │   • Popup au clic: adresse, classe, date, surface    │     │
│  └─────────────────────────────────────────────────────┘     │
│                                                             │
│  📋 LISTE (triable)                                         │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Adresse              | Classe | Date DPE | Surface | Score │
│  │ 12 Rue de la Paix    |   F    | 15/08/26 | 85m²    |  —   │
│  │ 8 Av. Victor Hugo    |   G    | 14/08/26 | 62m²    |  —   │
│  │ ...                                                  │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  [Exporter CSV]  [Exporter vers CRM ▼]  [⚡ Calculer scores]│
└─────────────────────────────────────────────────────────────┘
```

#### US-DPE-002 : Fiche DPE détaillée
**En tant que** négociateur,  
**Je veux** consulter la fiche complète d'un DPE,  
**Afin de** comprendre le contexte énergétique du bien avant de contacter le propriétaire.

**Critères d'acceptation** :
- [ ] Affichage de la classe énergie (A–G) avec code couleur standardisé
- [ ] Consommation kWh/m²/an et émission kgCO2/m²/an
- [ ] Date du diagnostic et date d'expiration
- [ ] Type de chauffage et ECS
- [ ] Lien vers le PDF officiel ADEME (si disponible)
- [ ] Historique des DPE sur ce bien (évolution dans le temps)
- [ ] Bouton "Calculer le score opportunité" (si pas encore calculé)

#### US-DPE-003 : Filtrage avancé
**En tant que** négociateur,  
**Je veux** filtrer les DPE par multiple critères combinés,  
**Afin de** cibler précisément mon secteur.

**Critères d'acceptation** :
- [ ] Filtre par classe énergie (multi-sélection A–G)
- [ ] Filtre par surface habitable (min/max)
- [ ] Filtre par année de construction (min/max)
- [ ] Filtre géographique : code postal, ville, rayon autour d'un point, dessin libre sur carte
- [ ] Filtre par date du DPE (7j, 30j, 90j, 1an, tout)
- [ ] Filtre par type de bien (maison, appartement, immeuble)
- [ ] Combinaison des filtres avec opérateur ET
- [ ] Sauvegarde des filtres comme "Vue personnalisée"
- [ ] Partage de la vue par URL

---

## 4. Module Radar Annonces

### 4.1 Description
Suivi des annonces immobilières publiées sur les principaux portails. Permet de détecter les baisses de prix, les retraits d'annonce (vente réalisée ?) et d'enrichir le scoring.

### 4.2 User Stories

#### US-ANN-001 : Suivi des nouvelles annonces
**En tant que** négociateur,  
**Je veux** voir les nouvelles annonces publiées dans mon secteur,  
**Afin de** repérer les propriétaires déjà en démarche de vente.

**Critères d'acceptation** :
- [ ] Affichage des annonces des 24h, 7j, 30j
- [ ] Sources : SeLoger, LeBonCoin, MeilleursAgents, Orpi, FNAIM (via API partenaires ou flux)
- [ ] Matching automatique avec un bien existant dans DPE Radar (adresse normalisée + surface)
- [ ] Indication du statut : ACTIVE, PRICE_REDUCED, REMOVED, SOLD
- [ ] Historique des prix (courbe d'évolution)
- [ ] Bouton "Ajouter au pipeline" si matching avec un bien DPE

#### US-ANN-002 : Détection des baisses de prix
**En tant que** négociateur,  
**Je veux** être alerté des baisses de prix significatives (> 5%),  
**Afin de** contacter le propriétaire en difficulté de vente.

**Critères d'acceptation** :
- [ ] Calcul automatique de la variation de prix entre deux snapshots
- [ ] Seuil configurable par l'agence (défaut : 5%)
- [ ] Alertes temps réel ou digest quotidien
- [ ] Affichage de la courbe de prix sur la fiche bien

---

## 5. Module Radar Quartier

### 5.1 Description
Analyse des tendances de marché par quartier (IRIS) via les Demandes de Valeurs Foncières (DVF) et autres sources. Fournit le contexte local pour justifier l'approche du propriétaire.

### 5.2 User Stories

#### US-QUA-001 : Vue d'ensemble du marché local
**En tant que** négociateur,  
**Je veux** consulter les indicateurs de marché d'un quartier,  
**Afin de** préparer mon argumentaire de prospection.

**Critères d'acceptation** :
- [ ] Carte choroplèthe des prix au m² médian par IRIS
- [ ] Évolution des prix sur 12, 24, 36 mois (en %)
- [ ] Volume de transactions sur 12 mois
- [ ] Délai médian de vente (jours)
- [ ] Nombre de nouvelles annonces sur 30j
- [ ] Comparaison avec le département et la région
- [ ] Export PDF "Dossier quartier" pour le propriétaire

**Maquette textuelle** :
```
┌─────────────────────────────────────────────────────────────┐
│  RADAR QUARTIER — Lyon 6ème (IRIS 691230101)               │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌────────┐│
│  │ Prix m²     │ │ Évolution   │ │ Volume      │ │ Délai  ││
│  │ 5 420 €     │ │ +8.3% /12m  │ │ 47 ventes   │ │ 62j    ││
│  │ médian      │ │ 📈          │ │ /12m        │ │ médian ││
│  └─────────────┘ └─────────────┘ └─────────────┘ └────────┘│
│                                                             │
│  📈 Évolution prix au m² (36 mois)                         │
│  │                                                          │
│  │    ╱╲                                                     │
│  │   ╱  ╲____                                                │
│  │  ╱        ╲___                                             │
│  │ ╱             ╲____                                        │
│  │╱                   ╲_______                                 │
│  └───────────────────────────────────────────────────────    │
│    J-36  J-24  J-12   J-6   Maintenant                       │
│                                                             │
│  🏘️ Biens similaires vendus récemment (DVF)                 │
│  ┌────────────────────────────────────────────────────────┐  │
│  │ Adresse              | Surface | Prix    | Prix/m² | Date │
│  │ 5 Rue du Bât d'Argent| 78m²   | 395k€   | 5 064€  | Juin │
│  │ ...                                                    │  │
│  └────────────────────────────────────────────────────────┘  │
│                                                             │
│  [📄 Générer dossier quartier PDF]  [📤 Partager]           │
└─────────────────────────────────────────────────────────────┘
```

#### US-QUA-002 : Comparaison inter-quartiers
**En tant que** directeur d'agence,  
**Je veux** comparer les indicateurs de plusieurs quartiers,  
**Afin de** orienter mes négociateurs vers les zones les plus dynamiques.

**Critères d'acceptation** :
- [ ] Sélection multi-quartiers (IRIS ou communes)
- [ ] Tableau comparatif côte à côte
- [ ] Graphique en radar (6 axes : prix, évolution, volume, délai, DPE F/G, nouvelles annonces)
- [ ] Export Excel

---

## 6. Module Radar Opportunités

### 6.1 Description
Cœur du produit. Classement automatique des biens par score d'intention de vente (0–100) avec raisonnement explicable. C'est le module qui transforme les données brutes en actions commerciales.

### 6.2 User Stories

#### US-OPP-001 : Calcul du score opportunité
**En tant que** système,  
**Je veux** calculer un score de probabilité d'intention de vente pour chaque bien,  
**Afin de** prioriser les prospects pour les négociateurs.

**Critères d'acceptation** :
- [ ] Score entre 0 et 100, arrondi à l'entier
- [ ] Indice de confiance entre 0.0 et 1.0 (2 décimales)
- [ ] 3 à 5 raisons principales du score, triées par poids décroissant
- [ ] Recalcul automatique quotidien pour les biens dont le score a > 30j
- [ ] Recalcul immédiat si nouveau DPE ou nouveau signal de marché
- [ ] Versionning de l'algorithme (champ `version`)
- [ ] Score marqué `isStale=true` si données expirées
- [ ] Le score n'est JAMAIS affiché comme une certitude de vente

**Règles métier du scoring** :

| Facteur | Poids | Détail |
|---------|-------|--------|
| Sévérité DPE | 25% | G=95pts, F=80pts, E=50pts, D=30pts, C/B/A=10pts |
| Durée détention estimée | 20% | `min(années × 5, 100)` — source DVF ou estimation |
| Momentum marché | 20% | Volume ventes 12m vs 12m précédent |
| Tendance prix quartier | 15% | Variation % prix au m² 12m |
| Écart prix estimé/marché | 15% | Sous-évaluation = opportunité de plus-value |
| Récence DPE | 5% | Plus récent = signal plus frais |

**Exemple de sortie JSON** :
```json
{
  "score": 82,
  "confidence": 0.87,
  "reasons": [
    {
      "factor": "DPE_SEVERITY",
      "weight": 0.25,
      "description": "DPE G — interdiction de location 2025, urgence de vente maximale",
      "impact": "positive"
    },
    {
      "factor": "HOLDING_DURATION",
      "weight": 0.20,
      "description": "Durée de détention estimée : 18 ans — forte probabilité de mutation",
      "impact": "positive"
    },
    {
      "factor": "MARKET_MOMENTUM",
      "weight": 0.20,
      "description": "Volume des ventes +23% sur 12 mois dans le quartier",
      "impact": "positive"
    },
    {
      "factor": "NEIGHBORHOOD_TREND",
      "weight": 0.15,
      "description": "Évolution prix quartier : +9.2% sur 12 mois",
      "impact": "positive"
    },
    {
      "factor": "PRICE_GAP",
      "weight": 0.15,
      "description": "Prix estimé 12% sous le marché local — marge de négociation favorable",
      "impact": "positive"
    }
  ],
  "signals": {
    "dpeAgeMonths": 2,
    "holdingYears": 18,
    "priceTrend": 9.2,
    "marketVolumeChange": 23,
    "estimatedValue": 485000,
    "medianPriceM2": 5420
  }
}
```

#### US-OPP-002 : Classement des opportunités
**En tant que** négociateur,  
**Je veux** consulter une liste de biens classés par score décroissant,  
**Afin de** concentrer mon temps sur les meilleurs prospects.

**Critères d'acceptation** :
- [ ] Vue liste avec : adresse, ville, score (badge coloré), confiance, DPE, surface, date DPE
- [ ] Tri par : score, confiance, date DPE, surface, prix estimé
- [ ] Filtres : score min, confiance min, classes DPE, type de bien, rayon géo, statut pipeline
- [ ] Pagination (50 éléments/page) ou scroll infini
- [ ] Actions rapides : "Voir fiche", "Assigner", "Générer prospection", "Exporter"
- [ ] Indicateur visuel si le bien est déjà dans le pipeline

#### US-OPP-003 : Fiche opportunité complète
**En tant que** négociateur,  
**Je veux** consulter une fiche unifiée regroupant toutes les données d'un bien,  
**Afin de** préparer mon argumentaire en un seul écran.

**Critères d'acceptation** :
- [ ] Section "Score & Raisons" : score, confiance, 5 raisons avec icônes
- [ ] Section "DPE" : dernière classe, conso, date, historique
- [ ] Section "Marché" : prix au m² quartier, évolution, biens vendus similaires
- [ ] Section "Annonces" : annonces actives ou passées sur ce bien
- [ ] Section "Carte" : localisation avec heatmap des ventes autour
- [ ] Section "Actions" : boutons "Copilote IA", "Ajouter au pipeline", "Assigner", "Note"
- [ ] Section "Historique" : dates de consultation, exports, contacts tentés

**Maquette textuelle** :
```
┌─────────────────────────────────────────────────────────────┐
│  ← Retour aux opportunités        [⭐ Favori] [🖨️ Imprimer] │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  12 Rue de la Paix, 69006 Lyon                              │
│  Maison · 85m² · DPE G · Construit en 1962                 │
│                                                             │
│  ┌─────────────────────────────────────────────────────┐   │
│  │  SCORE D'OPPORTUNITÉ                                │   │
│  │                                                     │   │
│  │     ████████████████████████████████████  82/100    │   │
│  │                                                     │   │
│  │     Confiance : 87%  │  Algorithme v1.2             │   │
│  │                                                     │   │
│  │  🌡️ DPE G — interdiction location 2025              │   │
│  │  ⏱️ 18 ans de détention estimée                     │   │
│  │  📈 Marché local : +23% de volume, +9.2% de prix   │   │
│  │  💰 Sous-évalué de 12% vs marché                   │   │
│  │  📅 DPE récent (2 mois)                             │   │
│  └─────────────────────────────────────────────────────┘   │
│                                                             │
│  [🤖 Demander au Copilote]  [📋 Ajouter au pipeline]        │
│  [👤 Assigner à...]  [📝 Ajouter une note]  [📤 Exporter]   │
│                                                             │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐        │
│  │ 📊 MARCHÉ    │ │ 🏠 ANNONCES  │ │ 🗺️ CARTE     │        │
│  │              │ │              │ │              │        │
│  │ Prix m²:     │ │ Aucune       │ │ [Carte       │        │
│  │ 5 420€       │ │ annonce      │ │ interactive] │        │
│  │              │ │ active       │ │              │        │
│  │ Évol: +9.2%  │ │              │ │              │        │
│  │              │ │ 1 annonce    │ │              │        │
│  │ 5 ventes     │ │ retirée en   │ │              │        │
│  │ similaires   │ │ mars 2026    │ │              │        │
│  └──────────────┘ └──────────────┘ └──────────────┘        │
│                                                             │
│  📜 HISTORIQUE                                              │
│  • 21/08/26 09:15 — Score calculé (v1.2) par le système    │
│  • 21/08/26 09:15 — DPE G importé (ADEME)                  │
│  • 20/08/26 14:30 — Consultation par Julie D.              │
└─────────────────────────────────────────────────────────────┘
```

---

## 7. Module Copilote IA

### 7.1 Description
Assistant IA générant des stratégies de prospection personnalisées, des emails, SMS et scripts d'appel conformes au cadre légal. Le Copilote ne remplace pas le jugement de l'agent mais l'accélère.

### 7.2 User Stories

#### US-COP-001 : Génération de stratégie de prospection
**En tant que** négociateur,  
**Je veux** que l'IA me propose une stratégie de contact personnalisée pour un bien,  
**Afin de** maximiser mes chances d'obtenir un rendez-vous.

**Critères d'acceptation** :
- [ ] Le Copilote analyse : score, raisons, marché local, historique de l'agence
- [ ] Il propose : canal recommandé (email/SMS/téléphone), timing optimal, angle d'approche
- [ ] L'angle d'approche est formulé comme une "opportunité de marché", jamais comme une certitude de vente
- [ ] Mention du DPE uniquement comme contexte réglementaire, jamais comme accusation
- [ ] La stratégie inclut 3 variantes d'approche (directe, soft, valeur ajoutée)
- [ ] Temps de génération < 3 secondes
- [ ] Possibilité de régénérer avec des instructions supplémentaires

**Prompt système (verrouillé)** :
```
Tu es un coach commercial senior en immobilier français.
Tu aides un négociateur à contacter un propriétaire sur la base d'un score de probabilité de vente.

RÈGLES ABSOLUES :
1. Ne JAMAIS dire "nous savons que vous voulez vendre" ou toute formulation équivalente.
2. Toujours formuler comme une "opportunité de marché", "tendance locale" ou "information utile".
3. Mentionner le DPE uniquement comme contexte réglementaire (loi climat), jamais comme un problème personnel.
4. Respecter la loi ALUR, le RGPD et les recommandations de la DGCCRF.
5. Proposer un ton professionnel, empathique, jamais agressif.
6. Inclure toujours une mention sur le droit d'opposition et le respect de la vie privée.

FORMAT DE SORTIE (JSON) :
{
  "strategy": "string — synthèse de la stratégie en 2-3 phrases",
  "recommendedChannel": "EMAIL | SMS | PHONE_CALL",
  "timing": "string — quand contacter (ex: 'mardi matin, 10h')",
  "angle": "string — angle d'approche principal",
  "script": "string — script/email/SMS complet prêt à l'emploi",
  "subject": "string — objet de l'email (si EMAIL)",
  "followUp": "string — suggestion de relance",
  "legalDisclaimer": "string — mention légale obligatoire"
}
```

#### US-COP-002 : Génération d'email personnalisé
**En tant que** négociateur,  
**Je veux** générer un email personnalisé pour un propriétaire,  
**Afin de** initier le contact de manière professionnelle et conforme.

**Critères d'acceptation** :
- [ ] L'email est généré à partir du contexte du bien (score, raisons, marché)
- [ ] Le négociateur peut modifier l'email avant envoi
- [ ] Prévisualisation HTML côte à côte avec le texte brut
- [ ] Variables dynamiques : {{prenom_proprietaire}}, {{adresse}}, {{ville}}, {{prix_m2_quartier}}, {{evolution_prix}}
- [ ] Mention de désabonnement en bas d'email (lien opt-out)
- [ ] Signature automatique de l'agence (configurable dans les paramètres)
- [ ] Enregistrement dans `OutreachLog` avec statut DRAFT puis SENT
- [ ] Suivi des ouvertures et clics (pixel de tracking + liens trackés)

#### US-COP-003 : Script d'appel téléphonique
**En tant que** négociateur,  
**Je veux** un script d'appel téléphonique structuré,  
**Afin de** mener un entretien fluide et conforme.

**Critères d'acceptation** :
- [ ] Script en 4 parties : accroche (15s), présentation valeur (30s), question ouverte, proposition RDV
- [ ] Objections anticipées avec réponses suggérées ("Je ne veux pas vendre", "J'ai déjà une agence")
- [ ] Mention obligatoire : "Je vous appelle car votre bien présente des caractéristiques qui correspondent à la demande actuelle du marché"
- [ ] Pas de mention du score ou de la prédiction à l'oral
- [ ] Bouton "J'ai appelé" → enregistrement du résultat (RDV fixé, Pas intéressé, Ne pas rappeler)

---

## 8. Module CRM Intégré

### 8.1 Description
Pipeline de prospection intégré + connecteurs vers les CRM externes (Apimo, Hektor, Netty, etc.). Permet de suivre le cycle de vie d'une opportunité de la détection au mandat.

### 8.2 User Stories

#### US-CRM-001 : Pipeline de prospection
**En tant que** négociateur,  
**Je veux** faire avancer un bien dans un pipeline visuel,  
**Afin de** suivre mes opportunités de la détection au mandat.

**Critères d'acceptation** :
- [ ] Vue Kanban avec 6 colonnes : NOUVEAU → QUALIFIÉ → CONTACTÉ → RDV FIXÉ → MANDAT → ARCHIVÉ
- [ ] Glisser-déposer (drag & drop) d'une carte entre les colonnes
- [ ] Chaque carte affiche : adresse, score, DPE, photo (si disponible), date de dernière action
- [ ] Filtres par : négociateur assigné, score min, date, type de bien
- [ ] Compteur de biens par colonne
- [ ] Historique des transitions (qui, quand, commentaire)
- [ ] Alertes si un bien reste > 7j dans une colonne sans action

**Maquette textuelle** :
```
┌─────────────────────────────────────────────────────────────┐
│  PIPELINE CRM — 47 biens actifs                              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  [Nouveau 12]  [Qualifié 8]  [Contacté 15]  [RDV 7]  [Mandat 5]
│                                                             │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐        │
│  │ 12 Rue Paix │  │ 8 Av. Hugo  │  │ 3 Pl. Bellec│        │
│  │ Score: 82   │  │ Score: 76   │  │ Score: 91   │        │
│  │ DPE G · 85m²│  │ DPE F · 62m²│  │ DPE G · 110m│        │
│  │             │  │             │  │             │        │
│  │ 👤 Julie D. │  │ 👤 Marc L.  │  │ 👤 Julie D. │        │
│  │ 🕐 il y 2j  │  │ 🕐 il y 5j  │  │ 🕐 hier     │        │
│  └─────────────┘  └─────────────┘  └─────────────┘        │
│  ┌─────────────┐  ┌─────────────┐                           │
│  │ 5 Rue Fleur │  │ 22 Bd. Jean │                           │
│  │ Score: 68   │  │ Score: 71   │                           │
│  │ ...         │  │ ...         │                           │
│  └─────────────┘  └─────────────┘                           │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

#### US-CRM-002 : Connecteur Apimo
**En tant que** administrateur d'agence,  
**Je veux** synchroniser les opportunités DPE Radar avec mon CRM Apimo,  
**Afin de** centraliser mon activité commerciale.

**Critères d'acceptation** :
- [ ] Configuration OAuth2 avec Apimo (Client ID, Secret, redirect URI)
- [ ] Mapping des champs : DPE Radar Property ↔ Apimo Contact/Bien
- [ ] Synchronisation bidirectionnelle ou unidirectionnelle (configurable)
- [ ] Push automatique : quand un bien passe en "Contacté" ou "RDV Fixé"
- [ ] Push manuel : bouton "Exporter vers Apimo" sur la fiche
- [ ] Gestion des conflits (dernier modifié gagne)
- [ ] Log de synchronisation visible dans l'interface
- [ ] Retry automatique en cas d'échec (3 tentances)

#### US-CRM-003 : Connecteur générique (Webhook)
**En tant que** agence utilisant un CRM non natif,  
**Je veux** configurer un webhook pour recevoir les données DPE Radar,  
**Afin de** intégrer avec n'importe quel système.

**Critères d'acceptation** :
- [ ] URL webhook configurable dans les paramètres
- [ ] Sélection des événements déclencheurs : NEW_PROPERTY, SCORE_UPDATED, PIPELINE_CHANGED, OUTREACH_SENT
- [ ] Signature HMAC-SHA256 pour vérification d'authenticité
- [ ] Payload JSON standardisé
- [ ] Retry avec backoff exponentiel (5 tentances sur 24h)
- [ ] Visualisation des webhooks envoyés (statut, payload, réponse)

---

## 9. Module Alertes & Notifications

### 9.1 Description
Système d'alertes configurables par l'agence pour être notifié en temps réel ou en digest des nouvelles opportunités correspondant à des critères définis.

### 9.2 User Stories

#### US-ALR-001 : Création d'alerte personnalisée
**En tant que** négociateur,  
**Je veux** créer une alerte sur mes critères de prospection,  
**Afin d'être** notifié dès qu'un bien correspondant apparaît.

**Critères d'acceptation** :
- [ ] Nom de l'alerte personnalisable
- [ ] Critères : classes DPE, score min, type de bien, surface, code postal/ville/rayon, date DPE
- [ ] Fréquence : temps réel, quotidien (heure configurable), hebdomadaire (jour/heure)
- [ ] Canaux : notification in-app, email, SMS (option Pro+), webhook CRM
- [ ] Limite d'alertes par plan : Starter=3, Pro=10, Réseau=illimité
- [ ] Désactivation/activation rapide
- [ ] Historique des déclenchements

#### US-ALR-002 : Notification temps réel
**En tant que** négociateur,  
**Je veux** recevoir une notification dès qu'un bien avec score > 80 est détecté dans mon secteur,  
**Afin de** contacter le propriétaire dans les 24h.

**Critères d'acceptation** :
- [ ] Notification in-app (toaster/badge)
- [ ] Email avec résumé : adresse, score, raisons principales, lien direct fiche
- [ ] SMS (option Pro+) : "Nouvelle opportunité 82/100 — 12 Rue de la Paix, Lyon 6ème. Voir : [lien]"
- [ ] Pas de notification entre 21h et 8h (sauf configuration explicite)
- [ ] Regroupement si > 5 biens détectés en < 1h (digest)

---

## 10. Module Administration Multi-Agences

### 10.1 Description
Espace d'administration pour les directeurs d'agence et administrateurs réseau. Gestion des utilisateurs, des quotas, des intégrations et de la conformité.

### 10.2 User Stories

#### US-ADM-001 : Gestion des utilisateurs
**En tant que** directeur d'agence,  
**Je veux** inviter, modifier les rôles et désactiver des négociateurs,  
**Afin de** gérer mon équipe.

**Critères d'acceptation** :
- [ ] Invitation par email (lien Clerk)
- [ ] Rôles : Admin (tout), Manager (vue équipe + stats), Négociateur (ses biens uniquement)
- [ ] Attribution d'un secteur géographique par négociateur (optionnel)
- [ ] Désactivation temporaire ou définitive
- [ ] Transfert des biens assignés lors d'une désactivation

#### US-ADM-002 : Configuration CRM
**En tant que** administrateur,  
**Je veux** configurer la connexion avec mon CRM,  
**Afin de** synchroniser mes données.

**Critères d'acceptation** :
- [ ] Sélection du provider (Apimo, Hektor, Netty, Efficity, Safti, Webhook)
- [ ] Champs de configuration dynamiques selon le provider
- [ ] Test de connexion avec retour visuel (✅/❌)
- [ ] Mapping des champs personnalisables
- [ ] Activation/désactivation de la sync

#### US-ADM-003 : Paramètres de conformité
**En tant que** responsable conformité,  
**Je veux** configurer les règles RGPD de l'agence,  
**Afin de** respecter la réglementation.

**Critères d'acceptation** :
- [ ] Mention légale personnalisable pour les emails
- [ ] Délai de conservation des données (défaut : 36 mois)
- [ ] Activation du double opt-in pour les emails (option)
- [ ] Configuration du DPO (nom, email)
- [ ] Export des données personnelles (format JSON, 30j max)
- [ ] Visualisation des opt-out et suppressions

---

## 11. Module Dashboard KPI

### 11.1 Description
Tableaux de bord analytiques par négociateur, par agence et par réseau. Mesure de l'efficacité de la prospection prédictive.

### 11.2 User Stories

#### US-KPI-001 : Dashboard négociateur
**En tant que** négociateur,  
**Je veux** voir mes indicateurs de performance,  
**Afin de** suivre mon activité et mes résultats.

**Critères d'acceptation** :
- [ ] Nombre d'opportunités consultées (7j, 30j, 90j)
- [ ] Nombre de contacts initiés (par canal)
- [ ] Taux de conversion : contacté → RDV → mandat
- [ ] Score moyen des biens contactés
- [ ] Délai médian entre détection et premier contact
- [ ] Top 3 raisons de conversion (facteurs de scoring les plus efficaces)
- [ ] Comparaison avec la moyenne de l'agence

#### US-KPI-002 : Dashboard agence
**En tant que** directeur d'agence,  
**Je veux** un tableau de bord global de mon agence,  
**Afin de** piloter mon activité commerciale.

**Critères d'acceptation** :
- [ ] Nombre total de biens indexés, nouveaux ce mois
- [ ] Répartition par score (camembert : <50, 50-70, 70-85, >85)
- [ ] Nombre de mandats signés via DPE Radar (tracker manuel ou CRM)
- [ ] ROI estimé : (commissions mandats × taux) / coût abonnement
- [ ] Activité par négociateur (classement)
- [ ] Taux d'utilisation (connexions/semaine)
- [ ] Export PDF mensuel

#### US-KPI-003 : Dashboard réseau (Plan Réseau uniquement)
**En tant que** directeur de réseau,  
**Je veux** comparer les performances de mes agences,  
**Afin de** identifier les bonnes pratiques et les agences en difficulté.

**Critères d'acceptation** :
- [ ] Tableau comparatif des agences (KPI clés)
- [ ] Carte de chaleur des opportunités par région
- [ ] Taux d'adoption de l'outil par agence
- [ ] Benchmark inter-agences
- [ ] Rapport automatisé hebdomadaire par email

---

## 12. Conformité RGPD & Légal

### 12.1 Base légale
Toutes les données utilisées sont **publiques** (DPE ADEME, DVF Etalab). La prospection s'appuie sur l'**intérêt légitime** (art. 6.1.f RGPD) pour la prospection prévisionnelle, sous réserve du droit d'opposition.

### 12.2 Exigences fonctionnelles de conformité

| Exigence | Implémentation |
|----------|---------------|
| **Traçabilité** | Table `AuditLog` : chaque action (consultation, export, contact) est journalisée avec IP, user-agent, timestamp |
| **Droit d'opposition** | Lien "Ne plus me contacter" dans chaque email/SMS. Suppression sous 72h. |
| **Durée de conservation** | Scores : 30j puis recalcul. DPE bruts : 36 mois. Outreach logs : 5 ans (obligation légale commerciale). |
| **Droit d'accès** | Export JSON des données personnelles depuis les paramètres |
| **Droit à l'effacement** | Suppression compte = suppression cascade des données personnelles (conservation anonymisée des stats) |
| **Sécurité** | RLS PostgreSQL, chiffrement AES-256 backups, MFA Clerk, rate limiting |
| **DPO** | Champ configurable dans les paramètres agence |

### 12.3 Messages obligatoires

**Email** :
```
Vous recevez cet email car votre bien présente des caractéristiques 
qui correspondent à la demande actuelle du marché immobilier local.

Conformément au RGPD, vous disposez d'un droit d'opposition à la prospection 
commerciale. Pour ne plus être contacté : [Se désinscrire]

DPE Radar AI — [Nom de l'agence]
[Adresse de l'agence]
```

**SMS** :
```
[Nom Agence] : votre quartier connaît une forte demande. 
Si un projet immobilier vous intéresse, contactez-nous au [téléphone]. 
STOP au [numéro court] pour ne plus recevoir de messages.
```

### 12.4 Interdictions absolues (hardcoded)
- [ ] Jamais de démarchage téléphonique automatique (pas de click-to-call sans action humaine)
- [ ] Jamais de mention du score au propriétaire
- [ ] Jamais de prédiction de vente formulée comme certitude
- [ ] Jamais de données non-publiques (pas de scraping de réseaux sociaux, pas d'achat de fichiers)

---

## 13. Annexes

### 13.1 Glossaire

| Terme | Définition |
|-------|-----------|
| **DPE** | Diagnostic de Performance Énergétique — obligatoire pour la vente/location |
| **DVF** | Demandes de Valeurs Foncières — base publique des transactions immobilières |
| **IRIS** | Ilots Regroupés pour l'Information Statistique — unité géo INSEE |
| **BAN** | Base Adresse Nationale — référentiel d'adresses officiel |
| **Score** | Probabilité d'intention de vente (0–100), JAMAIS une certitude |
| **Copilote IA** | Assistant générant des recommandations, JAMAIS un substitut au jugement humain |

### 13.2 Matrice des droits (RBAC)

| Fonction | Admin | Manager | Négociateur |
|----------|-------|---------|-------------|
| Voir tous les biens | ✅ | ✅ | ❌ (secteur assigné uniquement) |
| Modifier pipeline | ✅ | ✅ | ✅ (ses biens) |
| Gérer utilisateurs | ✅ | ❌ | ❌ |
| Configurer CRM | ✅ | ❌ | ❌ |
| Voir stats réseau | ✅ | ❌ | ❌ |
| Voir stats agence | ✅ | ✅ | ❌ |
| Voir ses stats | ✅ | ✅ | ✅ |
| Exporter données | ✅ | ✅ | ❌ |
| Gérer alertes | ✅ | ✅ | ✅ |
| Utiliser Copilote IA | ✅ | ✅ | ✅ |

### 13.3 Plan de tests d'acceptation (résumé)

| ID | Test | Type |
|----|------|------|
| TA-001 | Import de 10 000 DPE en < 5 minutes | Performance |
| TA-002 | Score calculé pour 1000 biens en < 2 minutes | Performance |
| TA-003 | Email généré par Copilote sans mention de certitude de vente | Compliance |
| TA-004 | Opt-out = suppression sous 72h | Compliance |
| TA-005 | Synchronisation CRM = données identiques dans les 2 systèmes | Intégration |
| TA-006 | Alertes temps réel déclenchées en < 30s après import DPE | Performance |
| TA-007 | RLS : négociateur A ne voit pas les biens de négociateur B | Sécurité |

---

*Document validé par : Product Owner, Lead Dev, DPO, UX Designer*  
*Date de validation : 21 août 2026*
