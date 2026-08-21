# DPE Radar AI — Spécification Technique & Architecture

> **Version** : 1.0  
> **Date** : 21 août 2026  
> **Classification** : Document d'architecture logicielle (SAD)  
> **Stack** : Next.js 15, React 19, TypeScript, Tailwind, Node.js, PostgreSQL, Prisma, Redis, Docker, Mapbox, Clerk, OpenAI

---

## 1. Vue d'ensemble

DPE Radar AI est un SaaS B2B de **prospection prédictive immobilière** qui aide les agences à identifier, de manière légale et transparente, les propriétaires ayant une forte probabilité de vendre dans les 3–12 prochains mois.

### 1.1 Principes directeurs
- **Jamais d'affirmation** : l'outil produit un *score de probabilité* (0–100) + indice de confiance + raisons explicites.
- **Conformité RGPD** : données publiques uniquement (DPE ADEME, DVF), pas de scraping privé.
- **Architecture hexagonale** : domaine pur, ports/adapters clairement séparés.
- **API-first** : connecteurs natifs vers Apimo, Hektor, Netty, etc.

---

## 2. Architecture Hexagonale (Ports & Adapters)

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                           PRESENTATION LAYER                                 │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────┐ │
│  │  Next.js    │  │  Dashboard  │  │  Mapbox     │  │  Copilote IA Chat   │ │
│  │  App Router │  │  React 19   │  │  GL JS      │  │  (OpenAI Stream)    │ │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────┘ │
│         └─────────────────┴─────────────────┴────────────────────┘            │
│                                    │                                         │
│                              tRPC / REST                                     │
│                                    │                                         │
├────────────────────────────────────┼─────────────────────────────────────────┤
│                           APPLICATION LAYER                                │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐   │
│  │                         API Gateway (Next.js)                          │   │
│  │  • Rate limiting (Redis)  • Auth Clerk  • Validation Zod            │   │
│  └─────────────────────────────────┬─────────────────────────────────────┘   │
│                                    │                                         │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐   │
│  │                      Application Services (Use Cases)                  │   │
│  │  CalculateOpportunityScore  │  SyncDpeBatch  │  GenerateOutreach    │   │
│  │  AlertEngine                │  CrmSync       │  NeighborhoodRadar     │   │
│  └─────────────────────────────────┬─────────────────────────────────────┘   │
│                                    │                                         │
├────────────────────────────────────┼─────────────────────────────────────────┤
│                            DOMAIN LAYER (Cœur)                              │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐   │
│  │                         Domain Services (Ports)                        │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │   │
│  │  │ IDpeRepository│ IPropertyRepo│ IScoringEngine│ IOutreachGenerator│  │   │
│  │  │ ICrmConnector │ IAlertQueue  │ ICacheStore   │ IAuditLogger      │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │   │
│  │                                                                        │   │
│  │  ┌─────────────────────────────────────────────────────────────────┐   │   │
│  │  │                    Entités & Value Objects                       │   │   │
│  │  │  Property │ DpeDiagnostic │ OpportunityScore │ OutreachStrategy  │   │   │
│  │  │  Neighborhood │ MarketSignal │ User │ Agency │ SubscriptionTier   │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                    │                                         │
├────────────────────────────────────┼─────────────────────────────────────────┤
│                         INFRASTRUCTURE LAYER (Adapters)                     │
│  ┌─────────────────────────────────┴─────────────────────────────────────┐   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │   │
│  │  │ Prisma/     │ │ Redis       │ │ ADEME API   │ │ API DVF         │  │   │
│  │  │ PostgreSQL  │ │ (Bull MQ)   │ │ (DPE)       │ │ (Etalab)        │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │   │
│  │  ┌─────────────┐ ┌─────────────┐ ┌─────────────┐ ┌─────────────────┐  │   │
│  │  │ OpenAI API  │ │ Mapbox      │ │ Webhooks    │ │ S3/MinIO        │  │   │
│  │  │ (GPT-4o)    │ │ Geocoding   │ │ CRM         │ │ (exports)       │  │   │
│  │  └─────────────┘ └─────────────┘ └─────────────┘ └─────────────────┘  │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## 3. Modèle de Données (Prisma Schema)

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ─── AUTH & MULTI-TENANT ───

model Agency {
  id            String    @id @default(cuid())
  name          String
  siret         String    @unique
  address       String
  city          String
  zipCode       String
  lat           Float
  lng           Float
  crmProvider   CrmProvider?
  crmWebhookUrl String?
  subscription  SubscriptionTier @default(STARTER)
  maxUsers      Int
  createdAt     DateTime  @default(now())
  updatedAt     DateTime  @updatedAt

  users         User[]
  properties    Property[]
  alerts        Alert[]
  outreachLogs  OutreachLog[]
  auditLogs     AuditLog[]
}

model User {
  id          String   @id @default(cuid())
  clerkId     String   @unique
  email       String   @unique
  firstName   String
  lastName    String
  role        UserRole @default(NEGOTIATOR)
  agencyId    String
  agency      Agency   @relation(fields: [agencyId], references: [id])
  createdAt   DateTime @default(now())

  assignedProperties Property[] @relation("AssignedNegotiator")
  outreachLogs       OutreachLog[]
}

enum UserRole {
  ADMIN
  MANAGER
  NEGOTIATOR
}

enum SubscriptionTier {
  STARTER
  PRO
  NETWORK
}

// ─── IMMOBILIER & DPE ───

model Property {
  id                String   @id @default(cuid())

  // Identifiants publics
  ademeDpeId        String?  @unique
  parcelleCadastre  String?

  // Adresse normalisée (BAN)
  address           String
  city              String
  zipCode           String
  lat               Float
  lng               Float
  irisCode          String?  // Pour les stats INSEE

  // Caractéristiques
  propertyType      PropertyType
  surfaceM2         Float?
  constructionYear  Int?
  nbRooms           Int?

  // Relations
  agencyId          String
  agency            Agency   @relation(fields: [agencyId], references: [id])
  assignedToId      String?
  assignedTo        User?    @relation("AssignedNegotiator", fields: [assignedToId], references: [id])

  dpeDiagnostics    DpeDiagnostic[]
  opportunityScores OpportunityScore[]
  marketSignals     MarketSignal[]
  outreachLogs      OutreachLog[]

  createdAt         DateTime @default(now())
  updatedAt         DateTime @updatedAt

  @@index([agencyId])
  @@index([lat, lng])
  @@index([zipCode])
}

enum PropertyType {
  APPARTEMENT
  MAISON
  IMMEUBLE
  TERRAIN
}

model DpeDiagnostic {
  id                String   @id @default(cuid())
  propertyId        String
  property          Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  // Données ADEME
  ademeReference    String   @unique
  dateDiagnostic    DateTime
  classeEnergie     DpeClass // A à G
  classeEmission    DpeClass?
  consoEnergie      Float?   // kWh/m²/an
  emissionGes       Float?   // kgCO2/m²/an

  // Métadonnées
  sourceRaw         Json?    // Payload brut ADEME
  syncedAt          DateTime @default(now())

  @@index([propertyId])
  @@index([classeEnergie])
  @@index([dateDiagnostic])
}

enum DpeClass {
  A
  B
  C
  D
  E
  F
  G
}

// ─── SCORING & OPPORTUNITÉS ───

model OpportunityScore {
  id              String   @id @default(cuid())
  propertyId      String
  property        Property @relation(fields: [propertyId], references: [id], onDelete: Cascade)

  score           Int      @db.SmallInt // 0–100
  confidenceIndex Float    // 0.0–1.0

  // Raisonnement explicable (XAI)
  topReasons      Json     // [{"factor": "DPE_F_G", "weight": 0.35, "description": "..."}]

  // Signaux agrégés
  signals         Json     // {"dpeAgeMonths": 24, "holdingYears": 15, "priceTrend": 1.08}

  // Lifecycle
  calculatedAt    DateTime @default(now())
  expiresAt       DateTime // Recalcul obligatoire
  isStale         Boolean  @default(false)

  @@index([propertyId])
  @@index([score])
  @@index([calculatedAt])
}

// ─── MARCHÉ & DVF ───

model MarketSignal {
  id              String   @id @default(cuid())
  propertyId      String?
  property        Property? @relation(fields: [propertyId], references: [id])

  irisCode        String
  zipCode         String

  signalType      MarketSignalType
  value           Float
  unit            String
  periodStart     DateTime
  periodEnd       DateTime
  source          String   // "DVF", "SeLoger", "MeilleursAgents"

  @@index([irisCode])
  @@index([zipCode])
  @@index([signalType])
}

enum MarketSignalType {
  MEDIAN_PRICE_M2
  PRICE_VARIATION_12M
  VOLUME_SALES_12M
  DAYS_ON_MARKET
  NEW_LISTINGS_30D
}

// ─── ALERTES & PROSPECTION ───

model Alert {
  id          String    @id @default(cuid())
  agencyId    String
  agency      Agency    @relation(fields: [agencyId], references: [id])

  name        String
  criteria    Json      // Filtres du radar (DPE F/G, quartier, score min...)
  channels    Json      // ["in_app", "email", "webhook_crm"]
  frequency   AlertFrequency @default(REALTIME)
  isActive    Boolean   @default(true)

  lastRunAt   DateTime?
  createdAt   DateTime  @default(now())
}

enum AlertFrequency {
  REALTIME
  DAILY
  WEEKLY
}

model OutreachLog {
  id              String   @id @default(cuid())
  propertyId      String
  property        Property @relation(fields: [propertyId], references: [id])
  agencyId        String
  agency          Agency   @relation(fields: [agencyId], references: [id])
  userId          String?
  user            User?    @relation(fields: [userId], references: [id])

  channel         OutreachChannel
  content         String   @db.Text
  aiGenerated     Boolean  @default(false)
  aiPromptTokens  Int?

  status          OutreachStatus @default(DRAFT)
  sentAt          DateTime?

  // RGPD : traçabilité du consentement
  legalBasis      String   // "prospection_previsionnelle_article_6_1_f"

  createdAt       DateTime @default(now())
}

enum OutreachChannel {
  EMAIL
  SMS
  PHONE_CALL
  LINKEDIN
  COURRIER
}

enum OutreachStatus {
  DRAFT
  SCHEDULED
  SENT
  DELIVERED
  REPLIED
  CONVERTED
}

// ─── AUDIT & CONFORMITÉ ───

model AuditLog {
  id          String   @id @default(cuid())
  agencyId    String
  agency      Agency   @relation(fields: [agencyId], references: [id])

  action      String   // "SCORE_CALCULATED", "PROPERTY_EXPORTED", "ALERT_TRIGGERED"
  entityType  String
  entityId    String
  metadata    Json?

  performedBy String?  // userId ou "SYSTEM"
  ipAddress   String?
  userAgent   String?

  createdAt   DateTime @default(now())

  @@index([agencyId])
  @@index([action])
  @@index([createdAt])
}
```

---

## 4. Services Métier (Domain Layer)

### 4.1 Scoring Engine — Algorithme de probabilité d'intention de vente

```typescript
// src/domain/services/scoring-engine.ts

interface ScoringInput {
  dpe: DpeDiagnostic;
  property: Property;
  marketSignals: MarketSignal[];
  holdingEstimateYears: number;
}

interface ScoringResult {
  score: number;           // 0–100
  confidence: number;      // 0.0–1.0
  reasons: ScoreReason[];
  signals: Record<string, unknown>;
}

interface ScoreReason {
  factor: string;
  weight: number;
  description: string;
  impact: 'positive' | 'negative' | 'neutral';
}

export class ScoringEngine {
  private readonly WEIGHTS = {
    DPE_SEVERITY: 0.25,
    HOLDING_DURATION: 0.20,
    MARKET_MOMENTUM: 0.20,
    NEIGHBORHOOD_TREND: 0.15,
    PRICE_GAP: 0.15,
    RECENCY_DPE: 0.05,
  };

  calculate(input: ScoringInput): ScoringResult {
    const reasons: ScoreReason[] = [];
    let rawScore = 0;

    // 1. DPE F/G = fort levier réglementaire (interdiction location 2028)
    const dpeScore = this.scoreDpe(input.dpe);
    rawScore += dpeScore * this.WEIGHTS.DPE_SEVERITY;
    reasons.push({
      factor: 'DPE_SEVERITY',
      weight: this.WEIGHTS.DPE_SEVERITY,
      description: this.dpeReasonText(input.dpe.classeEnergie),
      impact: dpeScore > 60 ? 'positive' : 'neutral',
    });

    // 2. Durée de détention estimée (>10 ans = +forte probabilité)
    const holdingScore = Math.min(input.holdingEstimateYears * 5, 100);
    rawScore += holdingScore * this.WEIGHTS.HOLDING_DURATION;
    reasons.push({
      factor: 'HOLDING_DURATION',
      weight: this.WEIGHTS.HOLDING_DURATION,
      description: `Durée de détention estimée : ${input.holdingEstimateYears} ans`,
      impact: input.holdingEstimateYears > 10 ? 'positive' : 'neutral',
    });

    // 3. Momentum du marché local (volume + prix)
    const marketScore = this.scoreMarketMomentum(input.marketSignals);
    rawScore += marketScore * this.WEIGHTS.MARKET_MOMENTUM;
    reasons.push({
      factor: 'MARKET_MOMENTUM',
      weight: this.WEIGHTS.MARKET_MOMENTUM,
      description: `Volume des ventes +${marketScore.toFixed(0)}% sur 12 mois`,
      impact: marketScore > 50 ? 'positive' : 'neutral',
    });

    // 4. Tendance du quartier (prix au m²)
    const trendScore = this.scoreNeighborhoodTrend(input.marketSignals);
    rawScore += trendScore * this.WEIGHTS.NEIGHBORHOOD_TREND;
    reasons.push({
      factor: 'NEIGHBORHOOD_TREND',
      weight: this.WEIGHTS.NEIGHBORHOOD_TREND,
      description: `Évolution prix quartier : ${trendScore > 0 ? '+' : ''}${trendScore.toFixed(1)}%`,
      impact: trendScore > 3 ? 'positive' : trendScore < -3 ? 'negative' : 'neutral',
    });

    // 5. Écart prix potentiel / prix du marché
    const gapScore = this.scorePriceGap(input);
    rawScore += gapScore * this.WEIGHTS.PRICE_GAP;

    // 6. Récence du DPE (plus récent = signal plus frais)
    const recencyScore = this.scoreDpeRecency(input.dpe);
    rawScore += recencyScore * this.WEIGHTS.RECENCY_DPE;

    const finalScore = Math.round(Math.min(Math.max(rawScore, 0), 100));
    const confidence = this.computeConfidence(input);

    // Trier les raisons par poids décroissant
    reasons.sort((a, b) => b.weight - a.weight);

    return {
      score: finalScore,
      confidence,
      reasons: reasons.slice(0, 5),
      signals: {
        dpeAgeMonths: this.monthsSince(input.dpe.dateDiagnostic),
        holdingYears: input.holdingEstimateYears,
        priceTrend: trendScore,
        marketVolumeChange: marketScore,
      },
    };
  }

  private scoreDpe(dpe: DpeDiagnostic): number {
    switch (dpe.classeEnergie) {
      case 'G': return 95;
      case 'F': return 80;
      case 'E': return 50;
      case 'D': return 30;
      default: return 10;
    }
  }

  private scoreMarketMomentum(signals: MarketSignal[]): number {
    const volumeSignal = signals.find(s => s.signalType === 'VOLUME_SALES_12M');
    if (!volumeSignal) return 50;
    return Math.min(Math.max(volumeSignal.value * 10 + 50, 0), 100);
  }

  private scoreNeighborhoodTrend(signals: MarketSignal[]): number {
    const priceSignal = signals.find(s => s.signalType === 'PRICE_VARIATION_12M');
    return priceSignal?.value ?? 0;
  }

  private computeConfidence(input: ScoringInput): number {
    let confidence = 0.7; // Base
    if (input.marketSignals.length >= 3) confidence += 0.15;
    if (input.dpe.consoEnergie) confidence += 0.10;
    if (input.holdingEstimateYears > 0) confidence += 0.05;
    return Math.min(confidence, 0.98);
  }

  private monthsSince(date: Date): number {
    return Math.floor((Date.now() - date.getTime()) / (1000 * 60 * 60 * 24 * 30));
  }

  private dpeReasonText(classe: DpeClass): string {
    const map: Record<DpeClass, string> = {
      A: 'DPE A — pas de levier réglementaire',
      B: 'DPE B — performance correcte',
      C: 'DPE C — standard moyen',
      D: 'DPE D — amélioration possible',
      E: 'DPE E — interdiction de location à venir (2034)',
      F: 'DPE F — interdiction de location 2028, forte incitation à vendre',
      G: 'DPE G — interdiction de location 2025, urgence de vente maximale',
    };
    return map[classe];
  }
}
```

### 4.2 Copilote IA — Génération de stratégie de prospection

```typescript
// src/domain/services/copilot-service.ts

import OpenAI from 'openai';

export class CopilotService {
  private openai: OpenAI;

  async generateOutreachStrategy(
    property: Property,
    score: OpportunityScore,
    user: User,
    channel: OutreachChannel
  ): Promise<{ strategy: string; script: string; subject?: string }> {
    const systemPrompt = `Tu es un coach commercial senior en immobilier français. 
Tu aides un négociateur à contacter un propriétaire sur la base d'un score de probabilité de vente.
RÈGLES STRICTES :
- Ne JAMAIS dire "nous savons que vous voulez vendre"
- Toujours formuler comme une "opportunité de marché" ou "tendance locale"
- Mentionner le DPE uniquement comme contexte réglementaire, pas comme accusation
- Respecter la loi ALUR et le RGPD`;

    const userPrompt = `Propriété : ${property.address}, ${property.city}
Type : ${property.propertyType}, ${property.surfaceM2}m²
Score opportunité : ${score.score}/100 (confiance : ${Math.round(score.confidence * 100)}%)
Raisons principales :
${score.topReasons.map(r => `- ${r.description}`).join('\n')}
Canal : ${channel}
Négociateur : ${user.firstName} ${user.lastName}`;

    const completion = await this.openai.chat.completions.create({
      model: 'gpt-4o',
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      temperature: 0.7,
      response_format: { type: 'json_object' },
    });

    return JSON.parse(completion.choices[0].message.content!);
  }
}
```

---

## 5. Infrastructure & Adapters

### 5.1 Synchronisation ADEME DPE (Cron horaire)

```typescript
// src/infrastructure/adapters/ademe-dpe-adapter.ts

export class AdemeDpeAdapter implements IDpeRepository {
  private readonly API_URL = 'https://observatoire-dpe-audit.ademe.fr/pub/dpe';

  async fetchLatestDiagnostics(since: Date): Promise<RawDpePayload[]> {
    const params = new URLSearchParams({
      date_debut: since.toISOString().split('T')[0],
      // Filtre géographique possible via code INSEE ou bbox
    });

    const res = await fetch(`${this.API_URL}?${params}`, {
      headers: { 'Accept': 'application/json' },
    });

    if (!res.ok) throw new AdemeApiError(`HTTP ${res.status}`);
    return res.json();
  }

  async deduplicateAndSave(rawList: RawDpePayload[]): Promise<DpeDiagnostic[]> {
    // Dédoublonnage par adresse normalisée (BAN) + surface + date
    // Éviter les re-DPE récents sur même bien
    const unique = new Map<string, RawDpePayload>();
    for (const raw of rawList) {
      const key = `${raw.adresse_normalisee}_${raw.surface_habitable}_${raw.date_etablissement_dpe}`;
      if (!unique.has(key)) unique.set(key, raw);
    }
    return Array.from(unique.values()).map(this.mapToEntity);
  }
}
```

### 5.2 Intégration DVF (Demandes de Valeurs Foncières)

```typescript
// src/infrastructure/adapters/dvf-adapter.ts

export class DvfAdapter implements IMarketDataRepository {
  private readonly API_URL = 'https://apidf-preprod.cerema.fr/dvf';

  async getLocalMarketData(
    irisCode: string,
    propertyType: PropertyType
  ): Promise<MarketSignal[]> {
    const res = await fetch(
      `${this.API_URL}/api/mutations?code_iris=${irisCode}&type_local=${this.mapType(propertyType)}`
    );
    const data = await res.json();

    return [
      {
        signalType: 'MEDIAN_PRICE_M2',
        value: this.computeMedianPrice(data.mutations),
        unit: 'EUR/m²',
        periodStart: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(),
        source: 'DVF',
      },
      {
        signalType: 'VOLUME_SALES_12M',
        value: data.mutations.length,
        unit: 'transactions',
        periodStart: new Date(Date.now() - 365 * 24 * 60 * 60 * 1000),
        periodEnd: new Date(),
        source: 'DVF',
      },
    ];
  }
}
```

### 5.3 Connecteurs CRM

```typescript
// src/infrastructure/adapters/crm/apimo-connector.ts
// src/infrastructure/adapters/crm/hektor-connector.ts
// src/infrastructure/adapters/crm/netty-connector.ts

interface ICrmConnector {
  name: string;
  pushProperty(property: Property, score: OpportunityScore): Promise<void>;
  pushContact(contact: CrmContact): Promise<void>;
  syncPipeline(stage: PipelineStage): Promise<void>;
}

// Implémentation générique via webhook + API REST OAuth2
export class GenericCrmConnector implements ICrmConnector {
  constructor(
    private config: { webhookUrl: string; apiKey: string; provider: CrmProvider }
  ) {}

  async pushProperty(property: Property, score: OpportunityScore): Promise<void> {
    const payload = {
      externalId: property.id,
      address: property.address,
      city: property.city,
      opportunityScore: score.score,
      confidence: score.confidence,
      reasons: score.topReasons,
      dpeClass: property.dpeDiagnostics[0]?.classeEnergie,
      source: 'DPE_RADAR_AI',
    };

    await fetch(this.config.webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
        'X-Source': 'dpe-radar-ai',
      },
      body: JSON.stringify(payload),
    });
  }
}
```

---

## 6. Frontend — Next.js 15 App Router

### 6.1 Structure des routes

```
app/
├── (auth)/
│   ├── login/page.tsx          # Clerk sign-in
│   └── onboarding/page.tsx     # Configuration agence
├── (dashboard)/
│   ├── layout.tsx              # Sidebar + Header
│   ├── page.tsx                # Dashboard principal (KPI)
│   ├── radar/
│   │   ├── dpe/page.tsx        # Radar DPE
│   │   ├── annonces/page.tsx   # Radar Annonces
│   │   ├── quartier/page.tsx   # Radar Quartier
│   │   └── opportunites/page.tsx # Radar Opportunités (scoring)
│   ├── carte/page.tsx          # Carte Mapbox interactive
│   ├── copilote/page.tsx       # Interface chat Copilote IA
│   ├── proprietes/
│   │   └── [id]/page.tsx       # Fiche bien détaillée
│   ├── equipe/page.tsx         # Gestion négociateurs
│   ├── alertes/page.tsx        # Configuration alertes
│   └── parametres/page.tsx     # CRM, exports, facturation
├── api/
│   ├── trpc/[trpc]/route.ts    # Router tRPC
│   ├── webhooks/
│   │   ├── clerk/route.ts      # Sync utilisateurs
│   │   └── crm/[provider]/route.ts # Réception webhooks CRM
│   └── cron/
│       ├── sync-dpe/route.ts   # Vercel Cron (hourly)
│       ├── sync-dvf/route.ts   # Daily
│       └── recalculate-scores/route.ts # Daily
└── layout.tsx
```

### 6.2 Composants clés

```typescript
// Composant carte interactive — Radar Quartier + Opportunités
// app/components/map/radar-map.tsx

'use client';
import { useState } from 'react';
import Map, { Source, Layer, Popup } from 'react-map-gl/maplibre';
import 'maplibre-gl/dist/maplibre-gl.css';

interface RadarMapProps {
  properties: PropertyWithScore[];
  onPropertyClick: (id: string) => void;
}

export function RadarMap({ properties, onPropertyClick }: RadarMapProps) {
  const [hovered, setHovered] = useState<string | null>(null);

  const geojson = {
    type: 'FeatureCollection',
    features: properties.map(p => ({
      type: 'Feature',
      geometry: { type: 'Point', coordinates: [p.lng, p.lat] },
      properties: {
        id: p.id,
        score: p.opportunityScores[0]?.score ?? 0,
        dpeClass: p.dpeDiagnostics[0]?.classeEnergie,
      },
    })),
  };

  return (
    <Map
      initialViewState={{ latitude: 48.8566, longitude: 2.3522, zoom: 12 }}
      style={{ width: '100%', height: '100%' }}
      mapStyle="https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json"
    >
      <Source id="properties" type="geojson" data={geojson}>
        <Layer
          id="property-circles"
          type="circle"
          paint={{
            'circle-radius': ['interpolate', ['linear'], ['get', 'score'], 0, 6, 100, 20],
            'circle-color': [
              'interpolate', ['linear'], ['get', 'score'],
              0, '#22c55e',   // vert
              50, '#eab308',  // jaune
              80, '#ef4444',  // rouge
            ],
            'circle-opacity': 0.8,
            'circle-stroke-width': 2,
            'circle-stroke-color': '#fff',
          }}
        />
      </Source>

      {hovered && (
        <Popup
          longitude={/* */}
          latitude={/* */}
          onClose={() => setHovered(null)}
        >
          <PropertyPopup property={properties.find(p => p.id === hovered)!} />
        </Popup>
      )}
    </Map>
  );
}
```

### 6.3 Carte de score (UI)

```typescript
// app/components/opportunity/score-card.tsx

import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Thermometer, TrendingUp, Clock, MapPin } from 'lucide-react';

interface ScoreCardProps {
  property: PropertyWithScore;
}

export function OpportunityScoreCard({ property }: ScoreCardProps) {
  const score = property.opportunityScores[0];
  if (!score) return null;

  const getScoreColor = (s: number) => {
    if (s >= 80) return 'text-red-500';
    if (s >= 50) return 'text-amber-500';
    return 'text-green-500';
  };

  return (
    <div className="rounded-xl border bg-card p-6 shadow-sm hover:shadow-md transition-shadow">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{property.address}</p>
          <h3 className="text-lg font-semibold mt-1">{property.city}</h3>
        </div>
        <div className="text-right">
          <span className={`text-3xl font-bold ${getScoreColor(score.score)}`}>
            {score.score}
          </span>
          <p className="text-xs text-muted-foreground">/ 100</p>
        </div>
      </div>

      <Progress value={score.score} className="mt-4" />

      <div className="mt-4 flex items-center gap-2 text-sm">
        <Badge variant="outline">
          Confiance {Math.round(score.confidence * 100)}%
        </Badge>
        <Badge variant={property.dpeDiagnostics[0]?.classeEnergie === 'G' ? 'destructive' : 'secondary'}>
          DPE {property.dpeDiagnostics[0]?.classeEnergie}
        </Badge>
      </div>

      <div className="mt-4 space-y-2">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Raisons principales
        </p>
        {score.topReasons.slice(0, 3).map((reason, i) => (
          <div key={i} className="flex items-start gap-2 text-sm">
            {reason.factor === 'DPE_SEVERITY' && <Thermometer className="w-4 h-4 mt-0.5 text-red-400" />}
            {reason.factor === 'HOLDING_DURATION' && <Clock className="w-4 h-4 mt-0.5 text-blue-400" />}
            {reason.factor === 'MARKET_MOMENTUM' && <TrendingUp className="w-4 h-4 mt-0.5 text-green-400" />}
            {reason.factor === 'NEIGHBORHOOD_TREND' && <MapPin className="w-4 h-4 mt-0.5 text-purple-400" />}
            <span>{reason.description}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
```

---

## 7. Conformité RGPD & Cadre Légal

### 7.1 Base légale de la prospection

| Aspect | Mise en œuvre technique |
|--------|------------------------|
| **Données sources** | Uniquement DPE (ADEME, données publiques) et DVF (Etalab, open data) |
| **Pas de démarchage téléphonique non sollicité** | L'outil génère des *recommandations* ; l'appel reste à l'initiative de l'agent. Pas de click-to-call automatique. |
| **Base légale** | Intérêt légitime (art. 6.1.f RGPD) pour la prospection prévisionnelle, sous réserve du droit d'opposition. |
| **Droit d'opposition** | Bouton "Ne plus me contacter" dans chaque email/SMS généré. Webhook vers suppression. |
| **Traçabilité** | Table `AuditLog` : chaque consultation, export, alerte est journalisée avec IP et user agent. |
| **Durée de conservation** | Scores recalculés tous les 30 jours, suppression automatique des données brutes DPE au-delà de 36 mois. |

### 7.2 Journal d'audit (exemple)

```typescript
// Middleware d'audit
export async function auditMiddleware(
  action: string,
  req: NextRequest,
  handler: () => Promise<Response>
): Promise<Response> {
  const res = await handler();

  await prisma.auditLog.create({
    data: {
      action,
      entityType: 'PROPERTY',
      entityId: req.params.id,
      performedBy: req.auth?.userId,
      ipAddress: req.ip,
      userAgent: req.headers.get('user-agent'),
      metadata: { statusCode: res.status },
    },
  });

  return res;
}
```

---

## 8. Infrastructure & DevOps

### 8.1 Docker Compose (développement local)

```yaml
# docker-compose.yml
version: '3.9'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/dpe_radar?schema=public
      - REDIS_URL=redis://redis:6379
      - NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY=${NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY}
      - CLERK_SECRET_KEY=${CLERK_SECRET_KEY}
      - OPENAI_API_KEY=${OPENAI_API_KEY}
    depends_on:
      - db
      - redis

  db:
    image: postgis/postgis:16-3.4
    environment:
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: dpe_radar
    volumes:
      - postgres_data:/var/lib/postgresql/data
    ports:
      - "5432:5432"

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"

  worker:
    build:
      context: .
      dockerfile: Dockerfile.worker
    environment:
      - DATABASE_URL=postgresql://postgres:postgres@db:5432/dpe_radar?schema=public
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    command: ["node", "dist/worker.js"]

volumes:
  postgres_data:
```

### 8.2 Tâches Cron (Vercel / Bull MQ)

```typescript
// vercel.json
{
  "crons": [
    { "path": "/api/cron/sync-dpe", "schedule": "0 * * * *" },      // Toutes les heures
    { "path": "/api/cron/sync-dvf", "schedule": "0 3 * * *" },      // 3h du matin
    { "path": "/api/cron/recalculate-scores", "schedule": "0 4 * * *" } // 4h du matin
  ]
}
```

### 8.3 CI/CD GitHub Actions

```yaml
# .github/workflows/ci.yml
name: CI/CD DPE Radar AI

on:
  push:
    branches: [main, develop]
  pull_request:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: postgis/postgis:16-3.4
        env:
          POSTGRES_PASSWORD: postgres
        options: >-
          --health-cmd pg_isready
          --health-interval 10s
          --health-timeout 5s
          --health-retries 5
        ports:
          - 5432:5432
      redis:
        image: redis:7-alpine
        ports:
          - 6379:6379

    steps:
      - uses: actions/checkout@v4
      - uses: pnpm/action-setup@v3
        with:
          version: 9
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
          cache: 'pnpm'

      - run: pnpm install --frozen-lockfile
      - run: pnpm prisma generate
      - run: pnpm prisma migrate deploy
      - run: pnpm lint
      - run: pnpm test:unit
      - run: pnpm test:integration
      - run: pnpm build
```

---

## 9. Feuille de Route Technique Détaillée

### Phase 1 — Fondations (Sprint 0–4)
- [ ] Setup monorepo (Turborepo) + Docker + CI/CD
- [ ] Auth Clerk + modèle multi-agence
- [ ] Prisma schema v1 + migrations
- [ ] ADEME DPE adapter + cron horaire
- [ ] Dashboard basique (KPI agence)

### Phase 2 — Radar DPE (Sprint 5–8)
- [ ] Import batch DPE avec déduplication
- [ ] Normalisation adresse (API BAN)
- [ ] Carte Mapbox avec clustering
- [ ] Filtres avancés (classe DPE, surface, année)
- [ ] Alertes email temps réel

### Phase 3 — Intelligence (Sprint 9–14)
- [ ] Intégration DVF (API Cerema)
- [ ] Moteur de scoring v1 (règles métier)
- [ ] Radar Opportunités (classement par score)
- [ ] Explication des scores (XAI)
- [ ] Export CSV / CRM

### Phase 4 — Copilote & CRM (Sprint 15–20)
- [ ] Intégration OpenAI (GPT-4o)
- [ ] Génération emails/SMS/scripts
- [ ] Connecteurs Apimo, Hektor, Netty
- [ ] Pipeline CRM intégré
- [ ] A/B testing des messages

### Phase 5 — Scale & Monetisation (Sprint 21–26)
- [ ] Système d'abonnement (Stripe)
- [ ] Plans Starter / Pro / Réseau
- [ ] API publique (REST + webhooks)
- [ ] Application mobile (React Native)
- [ ] Statistiques avancées par négociateur

---

## 10. Business Model & Pricing (Implémentation)

```typescript
// src/domain/services/billing-service.ts

interface SubscriptionPlan {
  tier: SubscriptionTier;
  maxProperties: number;
  maxUsers: number;
  features: FeatureFlag[];
  monthlyPrice: number;
}

const PLANS: SubscriptionPlan[] = [
  {
    tier: 'STARTER',
    maxProperties: 500,
    maxUsers: 3,
    features: ['RADAR_DPE', 'RADAR_ANNONCES', 'BASIC_SCORING'],
    monthlyPrice: 99,
  },
  {
    tier: 'PRO',
    maxProperties: 5000,
    maxUsers: 10,
    features: ['RADAR_DPE', 'RADAR_ANNONCES', 'RADAR_QUARTIER', 'RADAR_OPPORTUNITES', 'COPILOTE_AI', 'CRM_SYNC'],
    monthlyPrice: 249,
  },
  {
    tier: 'NETWORK',
    maxProperties: 50000,
    maxUsers: 100,
    features: ['ALL_FEATURES', 'API_ACCESS', 'WHITE_LABEL', 'DEDICATED_SUPPORT'],
    monthlyPrice: 799,
  },
];
```

---

## 11. Métriques & Analytics

| Métrique | Source | Objectif |
|----------|--------|----------|
| **Time-to-Opportunity** | Diff entre 1er DPE F/G et score > 80 | < 24h |
| **Score Accuracy** | Taux de conversion mandat / score > 70 | > 15% |
| **CRM Sync Latency** | Temps de push vers CRM | < 5s |
| **DPE Coverage** | % biens avec DPE récent dans zone agence | > 85% |
| **User Engagement** | Connexions hebdo / négociateur | > 3 |

---

## 12. Sécurité

- **Clerk** : authentification, MFA, RBAC
- **Row Level Security (RLS)** : chaque requête Prisma filtre par `agencyId`
- **Rate limiting** : 100 req/min par clé API, 1000 req/min par agence
- **Encryption at rest** : PostgreSQL avec LUKS (prod), AES-256 backups
- **Secrets management** : GitHub Actions + Vercel env vars, jamais dans le code

---

*Document rédigé par l'équipe d'architecture DPE Radar AI — 21 août 2026*
