-- Migration: 20240821000000_init
-- Création de la base DPE Radar AI v1.0

-- Activer l'extension PostGIS
CREATE EXTENSION IF NOT EXISTS postgis;

-- ═══════════════════════════════════════════════════════════════
-- 1. ENUMS
-- ═══════════════════════════════════════════════════════════════

CREATE TYPE "UserRole" AS ENUM ('ADMIN', 'MANAGER', 'NEGOTIATOR');
CREATE TYPE "SubscriptionTier" AS ENUM ('STARTER', 'PRO', 'NETWORK');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'UNPAID');
CREATE TYPE "CrmProvider" AS ENUM ('APIMO', 'HEKTOR', 'NETTY', 'EFFICITY', 'SAFTI', 'GENERIC_WEBHOOK');
CREATE TYPE "PropertyType" AS ENUM ('APPARTEMENT', 'MAISON', 'IMMEUBLE', 'TERRAIN', 'PARKING', 'COMMERCE');
CREATE TYPE "DpeClass" AS ENUM ('A', 'B', 'C', 'D', 'E', 'F', 'G');
CREATE TYPE "MarketSignalType" AS ENUM (
  'MEDIAN_PRICE_M2', 'MEDIAN_PRICE_TOTAL', 'PRICE_VARIATION_12M', 
  'PRICE_VARIATION_24M', 'PRICE_VARIATION_36M', 'VOLUME_SALES_12M', 
  'VOLUME_SALES_24M', 'DAYS_ON_MARKET_MEDIAN', 'NEW_LISTINGS_30D', 
  'NEW_LISTINGS_90D', 'RATIO_DEMAND_SUPPLY'
);
CREATE TYPE "DataSource" AS ENUM ('DVF', 'SE_LOGER', 'MEILLEURS_AGENTS', 'LE_BON_COIN', 'ADEME', 'INSEE', 'ESTIMATION_INTERNAL');
CREATE TYPE "PipelineStatus" AS ENUM ('NEW', 'QUALIFIED', 'CONTACTED', 'MEETING', 'MANDATE', 'LOST', 'EXCLUDED');
CREATE TYPE "CrmSyncStatus" AS ENUM ('PENDING', 'SYNCED', 'FAILED', 'RETRYING');
CREATE TYPE "AlertFrequency" AS ENUM ('REALTIME', 'HOURLY', 'DAILY', 'WEEKLY');
CREATE TYPE "OutreachChannel" AS ENUM ('EMAIL', 'SMS', 'PHONE_CALL', 'LINKEDIN', 'COURRIER', 'WHATSAPP');
CREATE TYPE "OutreachStatus" AS ENUM ('DRAFT', 'SCHEDULED', 'SENT', 'DELIVERED', 'OPENED', 'CLICKED', 'REPLIED', 'CONVERTED', 'BOUNCED', 'OPTED_OUT');
CREATE TYPE "AuditAction" AS ENUM (
  'PROPERTY_CREATED', 'PROPERTY_VIEWED', 'PROPERTY_EXPORTED', 'PROPERTY_ASSIGNED',
  'SCORE_CALCULATED', 'SCORE_VIEWED', 'OUTREACH_CREATED', 'OUTREACH_SENT', 'OUTREACH_OPT_OUT',
  'ALERT_TRIGGERED', 'ALERT_CREATED', 'ALERT_DELETED', 'USER_INVITED', 'USER_ROLE_CHANGED',
  'CRM_SYNC_ATTEMPTED', 'CRM_SYNC_SUCCEEDED', 'CRM_SYNC_FAILED', 'SUBSCRIPTION_CHANGED',
  'DATA_EXPORTED', 'LOGIN', 'LOGOUT', 'PASSWORD_CHANGED'
);
CREATE TYPE "BillingEventType" AS ENUM (
  'TRIAL_STARTED', 'TRIAL_ENDED', 'SUBSCRIPTION_CREATED', 'SUBSCRIPTION_UPDATED',
  'SUBSCRIPTION_CANCELED', 'INVOICE_PAID', 'INVOICE_PAYMENT_FAILED', 
  'PAYMENT_SUCCEEDED', 'PAYMENT_FAILED', 'REFUND_ISSUED'
);
CREATE TYPE "ListingSource" AS ENUM ('SE_LOGER', 'LE_BON_COIN', 'MEILLEURS_AGENTS', 'ORPI', 'FNAIM', 'SAFTI', 'GENERIC');
CREATE TYPE "ListingStatus" AS ENUM ('ACTIVE', 'PRICE_REDUCED', 'REMOVED', 'SOLD', 'EXPIRED');
CREATE TYPE "JobStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'RETRYING', 'CANCELLED');

-- ═══════════════════════════════════════════════════════════════
-- 2. TABLES
-- ═══════════════════════════════════════════════════════════════

-- Agency
CREATE TABLE "Agency" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "siret" TEXT NOT NULL,
  "address" TEXT NOT NULL,
  "city" TEXT NOT NULL,
  "zipCode" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "location" geometry(Point, 4326),
  "crmProvider" "CrmProvider",
  "crmConfig" JSONB,
  "subscription" "SubscriptionTier" NOT NULL DEFAULT 'STARTER',
  "stripeCustomerId" TEXT,
  "stripeSubscriptionId" TEXT,
  "subscriptionStatus" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
  "trialEndsAt" TIMESTAMP(3),
  "maxUsers" INTEGER NOT NULL DEFAULT 3,
  "maxProperties" INTEGER NOT NULL DEFAULT 500,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Agency_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Agency_siret_key" UNIQUE ("siret"),
  CONSTRAINT "Agency_stripeCustomerId_key" UNIQUE ("stripeCustomerId"),
  CONSTRAINT "Agency_stripeSubscriptionId_key" UNIQUE ("stripeSubscriptionId")
);

-- User
CREATE TABLE "User" (
  "id" TEXT NOT NULL,
  "clerkId" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "phone" TEXT,
  "avatarUrl" TEXT,
  "role" "UserRole" NOT NULL DEFAULT 'NEGOTIATOR',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "agencyId" TEXT NOT NULL,
  "preferences" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "User_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "User_clerkId_key" UNIQUE ("clerkId"),
  CONSTRAINT "User_email_key" UNIQUE ("email"),
  CONSTRAINT "User_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Property
CREATE TABLE "Property" (
  "id" TEXT NOT NULL,
  "ademeDpeId" TEXT,
  "parcelleCadastre" TEXT,
  "banId" TEXT,
  "address" TEXT NOT NULL,
  "complement" TEXT,
  "city" TEXT NOT NULL,
  "zipCode" TEXT NOT NULL,
  "department" TEXT NOT NULL,
  "region" TEXT,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "location" geometry(Point, 4326),
  "irisCode" TEXT,
  "propertyType" "PropertyType" NOT NULL,
  "surfaceM2" DOUBLE PRECISION,
  "landSurfaceM2" DOUBLE PRECISION,
  "constructionYear" INTEGER,
  "nbRooms" INTEGER,
  "nbBedrooms" INTEGER,
  "nbFloors" INTEGER,
  "floorNumber" INTEGER,
  "hasElevator" BOOLEAN,
  "hasParking" BOOLEAN,
  "hasTerrace" BOOLEAN,
  "hasGarden" BOOLEAN,
  "estimatedValue" DOUBLE PRECISION,
  "estimatedAt" TIMESTAMP(3),
  "agencyId" TEXT NOT NULL,
  "assignedToId" TEXT,
  "pipelineStatus" "PipelineStatus" NOT NULL DEFAULT 'NEW',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Property_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Property_ademeDpeId_key" UNIQUE ("ademeDpeId"),
  CONSTRAINT "Property_banId_key" UNIQUE ("banId"),
  CONSTRAINT "Property_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "Property_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- DpeDiagnostic
CREATE TABLE "DpeDiagnostic" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "ademeReference" TEXT NOT NULL,
  "dateDiagnostic" TIMESTAMP(3) NOT NULL,
  "dateExpiration" TIMESTAMP(3),
  "classeEnergie" "DpeClass" NOT NULL,
  "classeEmission" "DpeClass",
  "consoEnergie" DOUBLE PRECISION,
  "emissionGes" DOUBLE PRECISION,
  "consoEnergieFinale" DOUBLE PRECISION,
  "surfaceHabitable" DOUBLE PRECISION,
  "surfaceLogement" DOUBLE PRECISION,
  "typeChauffage" TEXT,
  "typeEcs" TEXT,
  "sourceRaw" JSONB,
  "isLatest" BOOLEAN NOT NULL DEFAULT true,
  "syncedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "DpeDiagnostic_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DpeDiagnostic_ademeReference_key" UNIQUE ("ademeReference"),
  CONSTRAINT "DpeDiagnostic_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- OpportunityScore
CREATE TABLE "OpportunityScore" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "score" SMALLINT NOT NULL,
  "confidenceIndex" DOUBLE PRECISION NOT NULL,
  "topReasons" JSONB NOT NULL,
  "signalsSnapshot" JSONB NOT NULL,
  "version" TEXT NOT NULL DEFAULT '1.0',
  "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "isStale" BOOLEAN NOT NULL DEFAULT false,

  CONSTRAINT "OpportunityScore_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OpportunityScore_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- PropertyNote
CREATE TABLE "PropertyNote" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PropertyNote_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PropertyNote_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- MarketSignal
CREATE TABLE "MarketSignal" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT,
  "irisCode" TEXT NOT NULL,
  "zipCode" TEXT NOT NULL,
  "department" TEXT,
  "signalType" "MarketSignalType" NOT NULL,
  "value" DOUBLE PRECISION NOT NULL,
  "unit" TEXT NOT NULL,
  "periodStart" TIMESTAMP(3) NOT NULL,
  "periodEnd" TIMESTAMP(3) NOT NULL,
  "source" "DataSource" NOT NULL,
  "sourceUrl" TEXT,
  "sampleSize" INTEGER,
  "isInterpolated" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "MarketSignal_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "MarketSignal_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- PipelineStage
CREATE TABLE "PipelineStage" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "stage" "PipelineStatus" NOT NULL,
  "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "exitedAt" TIMESTAMP(3),
  "durationDays" INTEGER,
  "notes" TEXT,
  "movedBy" TEXT NOT NULL,
  "crmSyncStatus" "CrmSyncStatus" NOT NULL DEFAULT 'PENDING',
  "crmSyncError" TEXT,
  "crmExternalId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "PipelineStage_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "PipelineStage_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Alert
CREATE TABLE "Alert" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "criteria" JSONB NOT NULL,
  "channels" JSONB NOT NULL,
  "frequency" "AlertFrequency" NOT NULL DEFAULT 'REALTIME',
  "minScore" SMALLINT DEFAULT 50,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "lastRunAt" TIMESTAMP(3),
  "nextRunAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "Alert_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Alert_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- AlertRead
CREATE TABLE "AlertRead" (
  "id" TEXT NOT NULL,
  "alertId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "readAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AlertRead_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AlertRead_alertId_userId_key" UNIQUE ("alertId", "userId"),
  CONSTRAINT "AlertRead_alertId_fkey" FOREIGN KEY ("alertId") REFERENCES "Alert"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AlertRead_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- OutreachLog
CREATE TABLE "OutreachLog" (
  "id" TEXT NOT NULL,
  "propertyId" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "userId" TEXT,
  "channel" "OutreachChannel" NOT NULL,
  "subject" TEXT,
  "content" TEXT NOT NULL,
  "contentHtml" TEXT,
  "aiGenerated" BOOLEAN NOT NULL DEFAULT false,
  "aiModel" TEXT,
  "aiPromptTokens" INTEGER,
  "aiCompletionTokens" INTEGER,
  "aiPromptHash" TEXT,
  "strategy" TEXT,
  "status" "OutreachStatus" NOT NULL DEFAULT 'DRAFT',
  "scheduledAt" TIMESTAMP(3),
  "sentAt" TIMESTAMP(3),
  "deliveredAt" TIMESTAMP(3),
  "openedAt" TIMESTAMP(3),
  "clickedAt" TIMESTAMP(3),
  "repliedAt" TIMESTAMP(3),
  "openCount" INTEGER NOT NULL DEFAULT 0,
  "clickCount" INTEGER NOT NULL DEFAULT 0,
  "legalBasis" TEXT NOT NULL DEFAULT 'prospection_previsionnelle_art_6_1_f',
  "optOutRequested" BOOLEAN NOT NULL DEFAULT false,
  "optOutAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "OutreachLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "OutreachLog_propertyId_fkey" FOREIGN KEY ("propertyId") REFERENCES "Property"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "OutreachLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- AuditLog
CREATE TABLE "AuditLog" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "action" "AuditAction" NOT NULL,
  "entityType" TEXT NOT NULL,
  "entityId" TEXT NOT NULL,
  "metadata" JSONB,
  "performedBy" TEXT,
  "ipAddress" TEXT,
  "userAgent" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "AuditLog_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- BillingEvent
CREATE TABLE "BillingEvent" (
  "id" TEXT NOT NULL,
  "agencyId" TEXT NOT NULL,
  "eventType" "BillingEventType" NOT NULL,
  "stripeEventId" TEXT,
  "amount" DOUBLE PRECISION,
  "currency" TEXT NOT NULL DEFAULT 'EUR',
  "metadata" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "BillingEvent_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "BillingEvent_stripeEventId_key" UNIQUE ("stripeEventId"),
  CONSTRAINT "BillingEvent_agencyId_fkey" FOREIGN KEY ("agencyId") REFERENCES "Agency"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- Listing
CREATE TABLE "Listing" (
  "id" TEXT NOT NULL,
  "source" "ListingSource" NOT NULL,
  "externalId" TEXT NOT NULL,
  "url" TEXT NOT NULL,
  "address" TEXT,
  "city" TEXT,
  "zipCode" TEXT,
  "lat" DOUBLE PRECISION,
  "lng" DOUBLE PRECISION,
  "propertyType" "PropertyType",
  "surfaceM2" DOUBLE PRECISION,
  "price" DOUBLE PRECISION,
  "pricePerM2" DOUBLE PRECISION,
  "nbRooms" INTEGER,
  "status" "ListingStatus" NOT NULL DEFAULT 'ACTIVE',
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL,
  "removedAt" TIMESTAMP(3),
  "priceHistory" JSONB,
  "matchedPropertyId" TEXT,
  "matchConfidence" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "Listing_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "Listing_externalId_key" UNIQUE ("externalId"),
  CONSTRAINT "Listing_matchedPropertyId_fkey" FOREIGN KEY ("matchedPropertyId") REFERENCES "Property"("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- JobQueue
CREATE TABLE "JobQueue" (
  "id" TEXT NOT NULL,
  "queueName" TEXT NOT NULL,
  "jobType" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "status" "JobStatus" NOT NULL DEFAULT 'PENDING',
  "priority" INTEGER NOT NULL DEFAULT 5,
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "maxAttempts" INTEGER NOT NULL DEFAULT 3,
  "lastError" TEXT,
  "scheduledAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "JobQueue_pkey" PRIMARY KEY ("id")
);

-- ═══════════════════════════════════════════════════════════════
-- 3. INDEXES
-- ═══════════════════════════════════════════════════════════════

-- Agency
CREATE INDEX "Agency_location_idx" ON "Agency" USING GIST ("location");
CREATE INDEX "Agency_subscriptionStatus_idx" ON "Agency"("subscriptionStatus");
CREATE INDEX "Agency_createdAt_idx" ON "Agency"("createdAt");

-- User
CREATE INDEX "User_agencyId_idx" ON "User"("agencyId");
CREATE INDEX "User_clerkId_idx" ON "User"("clerkId");
CREATE INDEX "User_email_idx" ON "User"("email");

-- Property
CREATE INDEX "Property_agencyId_idx" ON "Property"("agencyId");
CREATE INDEX "Property_assignedToId_idx" ON "Property"("assignedToId");
CREATE INDEX "Property_lat_lng_idx" ON "Property"("lat", "lng");
CREATE INDEX "Property_location_idx" ON "Property" USING GIST ("location");
CREATE INDEX "Property_zipCode_idx" ON "Property"("zipCode");
CREATE INDEX "Property_irisCode_idx" ON "Property"("irisCode");
CREATE INDEX "Property_propertyType_idx" ON "Property"("propertyType");
CREATE INDEX "Property_pipelineStatus_idx" ON "Property"("pipelineStatus");
CREATE INDEX "Property_createdAt_idx" ON "Property"("createdAt");
CREATE INDEX "Property_updatedAt_idx" ON "Property"("updatedAt");
CREATE INDEX "Property_banId_idx" ON "Property"("banId");

-- DpeDiagnostic
CREATE INDEX "DpeDiagnostic_propertyId_idx" ON "DpeDiagnostic"("propertyId");
CREATE INDEX "DpeDiagnostic_classeEnergie_idx" ON "DpeDiagnostic"("classeEnergie");
CREATE INDEX "DpeDiagnostic_dateDiagnostic_idx" ON "DpeDiagnostic"("dateDiagnostic");
CREATE INDEX "DpeDiagnostic_ademeReference_idx" ON "DpeDiagnostic"("ademeReference");
CREATE INDEX "DpeDiagnostic_isLatest_idx" ON "DpeDiagnostic"("isLatest");
CREATE INDEX "DpeDiagnostic_syncedAt_idx" ON "DpeDiagnostic"("syncedAt");

-- OpportunityScore
CREATE INDEX "OpportunityScore_propertyId_idx" ON "OpportunityScore"("propertyId");
CREATE INDEX "OpportunityScore_score_idx" ON "OpportunityScore"("score");
CREATE INDEX "OpportunityScore_confidenceIndex_idx" ON "OpportunityScore"("confidenceIndex");
CREATE INDEX "OpportunityScore_calculatedAt_idx" ON "OpportunityScore"("calculatedAt");
CREATE INDEX "OpportunityScore_expiresAt_idx" ON "OpportunityScore"("expiresAt");
CREATE INDEX "OpportunityScore_isStale_idx" ON "OpportunityScore"("isStale");
CREATE INDEX "OpportunityScore_version_idx" ON "OpportunityScore"("version");

-- PropertyNote
CREATE INDEX "PropertyNote_propertyId_idx" ON "PropertyNote"("propertyId");
CREATE INDEX "PropertyNote_createdAt_idx" ON "PropertyNote"("createdAt");

-- MarketSignal
CREATE INDEX "MarketSignal_propertyId_idx" ON "MarketSignal"("propertyId");
CREATE INDEX "MarketSignal_irisCode_idx" ON "MarketSignal"("irisCode");
CREATE INDEX "MarketSignal_zipCode_idx" ON "MarketSignal"("zipCode");
CREATE INDEX "MarketSignal_signalType_idx" ON "MarketSignal"("signalType");
CREATE INDEX "MarketSignal_periodStart_periodEnd_idx" ON "MarketSignal"("periodStart", "periodEnd");
CREATE INDEX "MarketSignal_source_idx" ON "MarketSignal"("source");
CREATE INDEX "MarketSignal_createdAt_idx" ON "MarketSignal"("createdAt");

-- PipelineStage
CREATE INDEX "PipelineStage_propertyId_idx" ON "PipelineStage"("propertyId");
CREATE INDEX "PipelineStage_stage_idx" ON "PipelineStage"("stage");
CREATE INDEX "PipelineStage_enteredAt_idx" ON "PipelineStage"("enteredAt");
CREATE INDEX "PipelineStage_crmSyncStatus_idx" ON "PipelineStage"("crmSyncStatus");

-- Alert
CREATE INDEX "Alert_agencyId_idx" ON "Alert"("agencyId");
CREATE INDEX "Alert_isActive_idx" ON "Alert"("isActive");
CREATE INDEX "Alert_lastRunAt_idx" ON "Alert"("lastRunAt");

-- OutreachLog
CREATE INDEX "OutreachLog_propertyId_idx" ON "OutreachLog"("propertyId");
CREATE INDEX "OutreachLog_agencyId_idx" ON "OutreachLog"("agencyId");
CREATE INDEX "OutreachLog_userId_idx" ON "OutreachLog"("userId");
CREATE INDEX "OutreachLog_status_idx" ON "OutreachLog"("status");
CREATE INDEX "OutreachLog_channel_idx" ON "OutreachLog"("channel");
CREATE INDEX "OutreachLog_createdAt_idx" ON "OutreachLog"("createdAt");
CREATE INDEX "OutreachLog_optOutRequested_idx" ON "OutreachLog"("optOutRequested");

-- AuditLog
CREATE INDEX "AuditLog_agencyId_idx" ON "AuditLog"("agencyId");
CREATE INDEX "AuditLog_action_idx" ON "AuditLog"("action");
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");
CREATE INDEX "AuditLog_performedBy_idx" ON "AuditLog"("performedBy");
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- BillingEvent
CREATE INDEX "BillingEvent_agencyId_idx" ON "BillingEvent"("agencyId");
CREATE INDEX "BillingEvent_eventType_idx" ON "BillingEvent"("eventType");
CREATE INDEX "BillingEvent_createdAt_idx" ON "BillingEvent"("createdAt");

-- Listing
CREATE INDEX "Listing_source_idx" ON "Listing"("source");
CREATE INDEX "Listing_zipCode_idx" ON "Listing"("zipCode");
CREATE INDEX "Listing_status_idx" ON "Listing"("status");
CREATE INDEX "Listing_firstSeenAt_idx" ON "Listing"("firstSeenAt");
CREATE INDEX "Listing_lastSeenAt_idx" ON "Listing"("lastSeenAt");
CREATE INDEX "Listing_matchedPropertyId_idx" ON "Listing"("matchedPropertyId");

-- JobQueue
CREATE INDEX "JobQueue_queueName_idx" ON "JobQueue"("queueName");
CREATE INDEX "JobQueue_status_idx" ON "JobQueue"("status");
CREATE INDEX "JobQueue_scheduledAt_idx" ON "JobQueue"("scheduledAt");
CREATE INDEX "JobQueue_priority_idx" ON "JobQueue"("priority");

-- ═══════════════════════════════════════════════════════════════
-- 4. VIEWS (pour les requêtes fréquentes)
-- ═══════════════════════════════════════════════════════════════

-- Vue: Opportunités actives avec toutes les relations
CREATE VIEW "v_active_opportunities" AS
SELECT 
  p."id" as property_id,
  p."address",
  p."city",
  p."zipCode",
  p."lat",
  p."lng",
  p."propertyType",
  p."surfaceM2",
  p."pipelineStatus",
  p."assignedToId",
  d."classeEnergie" as dpe_class,
  d."consoEnergie" as dpe_conso,
  d."dateDiagnostic" as dpe_date,
  os."score",
  os."confidenceIndex" as confidence,
  os."topReasons" as reasons,
  os."calculatedAt" as score_date,
  os."isStale"
FROM "Property" p
LEFT JOIN "DpeDiagnostic" d ON d."propertyId" = p."id" AND d."isLatest" = true
LEFT JOIN "OpportunityScore" os ON os."propertyId" = p."id" 
  AND os."id" = (
    SELECT "id" FROM "OpportunityScore" 
    WHERE "propertyId" = p."id" 
    ORDER BY "calculatedAt" DESC 
    LIMIT 1
  )
WHERE p."pipelineStatus" NOT IN ('LOST', 'EXCLUDED');

-- Vue: Performance par négociateur (30 derniers jours)
CREATE VIEW "v_negotiator_performance" AS
SELECT 
  u."id" as user_id,
  u."firstName",
  u."lastName",
  u."agencyId",
  COUNT(DISTINCT p."id") as properties_assigned,
  COUNT(DISTINCT CASE WHEN p."pipelineStatus" = 'MANDATE' THEN p."id" END) as mandates_signed,
  COUNT(DISTINCT o."id") as outreach_sent,
  COUNT(DISTINCT CASE WHEN o."status" = 'CONVERTED' THEN o."id" END) as outreach_converted
FROM "User" u
LEFT JOIN "Property" p ON p."assignedToId" = u."id" AND p."updatedAt" > NOW() - INTERVAL '30 days'
LEFT JOIN "OutreachLog" o ON o."userId" = u."id" AND o."createdAt" > NOW() - INTERVAL '30 days'
WHERE u."role" = 'NEGOTIATOR' AND u."isActive" = true
GROUP BY u."id", u."firstName", u."lastName", u."agencyId";

-- ═══════════════════════════════════════════════════════════════
-- 5. FONCTIONS & TRIGGERS
-- ═══════════════════════════════════════════════════════════════

-- Fonction: Calcul automatique de la durée en jours dans un stage
CREATE OR REPLACE FUNCTION calculate_stage_duration()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW."exitedAt" IS NOT NULL AND NEW."enteredAt" IS NOT NULL THEN
    NEW."durationDays" := EXTRACT(DAY FROM (NEW."exitedAt" - NEW."enteredAt"));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_calculate_stage_duration
BEFORE UPDATE ON "PipelineStage"
FOR EACH ROW
EXECUTE FUNCTION calculate_stage_duration();

-- Fonction: Mise à jour automatique de updatedAt
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW."updatedAt" = CURRENT_TIMESTAMP;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_agency_updated_at BEFORE UPDATE ON "Agency"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_user_updated_at BEFORE UPDATE ON "User"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_property_updated_at BEFORE UPDATE ON "Property"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_alert_updated_at BEFORE UPDATE ON "Alert"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_outreach_updated_at BEFORE UPDATE ON "OutreachLog"
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- ═══════════════════════════════════════════════════════════════
-- 6. SEED DATA (Données de test minimales)
-- ═══════════════════════════════════════════════════════════════

INSERT INTO "Agency" ("id", "name", "siret", "address", "city", "zipCode", "lat", "lng", "subscription", "maxUsers", "maxProperties", "updatedAt")
VALUES 
  ('agency_demo_001', 'Agence Demo Paris', '12345678900011', '1 Rue de la Paix', 'Paris', '75001', 48.8698, 2.3311, 'PRO', 5, 1000, NOW()),
  ('agency_demo_002', 'Agence Demo Lyon', '12345678900012', '10 Place Bellecour', 'Lyon', '69002', 45.7578, 4.8320, 'STARTER', 3, 500, NOW());

INSERT INTO "User" ("id", "clerkId", "email", "firstName", "lastName", "role", "agencyId", "updatedAt")
VALUES
  ('user_demo_admin', 'clerk_demo_admin', 'admin@demo.fr', 'Admin', 'Demo', 'ADMIN', 'agency_demo_001', NOW()),
  ('user_demo_neg', 'clerk_demo_neg', 'julie@demo.fr', 'Julie', 'Demo', 'NEGOTIATOR', 'agency_demo_001', NOW());
