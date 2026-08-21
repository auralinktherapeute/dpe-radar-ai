/**
 * Ports de l'architecture hexagonale.
 *
 * Le domaine et les cas d'usage ne connaissent que ces interfaces. Aucune
 * signature ne laisse fuir un detail d'ADEME, de Prisma ou de Redis : c'est
 * la condition pour que le moteur de scoring reste testable et rejouable.
 */
import type { DpeClass } from '@domain/scoring/value-objects/DpeClass.js';
import type { GeoPrecisionLevel } from '@domain/scoring/value-objects/GeoPrecision.js';
import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';

export interface Clock {
  now(): Date;
}

/** Identifiant stable d'un bien : adresse normalisee, jamais une personne. */
export interface PropertyKey {
  readonly banId: string;
  readonly inseeCode: string;
}

export interface DpeRecord {
  /** Numero de DPE ADEME — cle de deduplication. */
  readonly dpeNumber: string;
  readonly dpeClass: DpeClass;
  readonly establishedAt: Date;
  readonly rawAddress: string;
  readonly inseeCode: string;
  readonly surfaceM2: number | null;
  readonly buildingType: 'appartement' | 'maison' | 'immeuble' | 'inconnu';
  /**
   * Geocodage deja present dans le jeu ADEME. Quand il est suffisamment
   * precis, il evite un appel au geocodeur : la BAN est un service public
   * a debit limite, et l'economie est de l'ordre de 95 % des appels.
   */
  readonly embeddedBanId: string | null;
  readonly embeddedPrecision: GeoPrecisionLevel;
}

export interface DpeSourcePort {
  /** Diagnostics publies depuis `since`, page par page. */
  fetchSince(since: Date, cursor?: string): Promise<{
    readonly records: readonly DpeRecord[];
    readonly nextCursor?: string;
  }>;
}

export interface NeighbourhoodStats {
  readonly salesLast12: number;
  readonly salesPrevious12: number;
  readonly pricePerSqmDelta12m: number;
  readonly medianDpeClass?: DpeClass;
  readonly observedAt: Date;
}

export interface MarketDataPort {
  statsFor(inseeCode: string, section: string | null): Promise<NeighbourhoodStats | null>;
  lastMutationAt(key: PropertyKey): Promise<Date | null>;
}

export interface ListingSnapshot {
  readonly active: boolean;
  readonly priceDropRatio?: number;
  readonly observedAt: Date;
}

export interface ListingSourcePort {
  snapshotFor(key: PropertyKey): Promise<ListingSnapshot | null>;
}

export interface GeocodeResult {
  readonly banId: string;
  readonly inseeCode: string;
  readonly precision: GeoPrecisionLevel;
  readonly latitude: number;
  readonly longitude: number;
  readonly section: string | null;
}

export interface GeocodingPort {
  geocode(rawAddress: string, inseeCode: string): Promise<GeocodeResult | null>;
}

export interface StoredProperty {
  readonly key: PropertyKey;
  readonly latitude: number;
  readonly longitude: number;
  readonly precision: GeoPrecisionLevel;
  readonly section: string | null;
}

export interface PropertyRepository {
  upsertFromDpe(record: DpeRecord, geo: GeocodeResult): Promise<StoredProperty>;
  hasDpe(dpeNumber: string): Promise<boolean>;
  find(key: PropertyKey): Promise<StoredProperty | null>;
}

export interface ScoreRepository {
  save(key: PropertyKey, score: OpportunityScore): Promise<void>;
}

/**
 * Liste de suppression : une opposition vaut pour TOUTES les agences
 * clientes, pas seulement celle qui l'a recue (docs/01-conformite).
 */
export interface SuppressionListPort {
  isSuppressed(key: PropertyKey): Promise<boolean>;
  suppress(key: PropertyKey, reason: string, at: Date): Promise<void>;
}

export type AuditEvent =
  | { readonly type: 'DPE_INGESTED'; readonly dpeNumber: string }
  | { readonly type: 'DPE_SKIPPED'; readonly dpeNumber: string; readonly cause: string }
  | { readonly type: 'SCORE_COMPUTED'; readonly banId: string; readonly scaleVersion: string; readonly score: number | null }
  | { readonly type: 'OUTREACH_DENIED'; readonly banId: string; readonly code: string }
  | { readonly type: 'OUTREACH_PREPARED'; readonly banId: string; readonly channel: string };

/** Journal immuable : qui, quoi, quand, avec quelle version de modele. */
export interface AuditLogPort {
  record(event: AuditEvent, at: Date): Promise<void>;
}

// ─────────────────── CRM, alertes, indicateurs ───────────────────

import type { Lead, LeadOutcome, LeadStage } from '@domain/crm/Lead.js';
import type { Alert, AlertRule } from '@domain/alerts/AlertRule.js';
import type { LeadTiming } from '@domain/analytics/AgencyKpis.js';

export interface LeadRepository {
  find(leadId: string): Promise<Lead | null>;
  save(lead: Lead): Promise<void>;
  listByAgency(agencyId: string): Promise<readonly Lead[]>;
  timingsByAgency(agencyId: string): Promise<readonly LeadTiming[]>;
  recordOutcome(leadId: string, outcome: LeadOutcome, at: Date): Promise<void>;
}

export interface AlertRuleRepository {
  listByAgency(agencyId: string): Promise<readonly AlertRule[]>;
  firedTodayCount(ruleId: string, day: Date): Promise<number>;
  wasNotified(ruleId: string, banId: string): Promise<boolean>;
}

/** Diffusion des alertes : push mobile, e-mail interne, websocket. */
export interface AlertSink {
  publish(alert: Alert): Promise<void>;
}

export interface AgencyRepository {
  find(agencyId: string): Promise<{
    readonly agencyId: string;
    readonly networkId: string | null;
    readonly name: string;
  } | null>;
}

export type { Lead, LeadOutcome, LeadStage, Alert, AlertRule, LeadTiming };
