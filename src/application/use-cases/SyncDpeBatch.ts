import type {
  AuditLogPort,
  Clock,
  DpeRecord,
  DpeSourcePort,
  GeocodeResult,
  GeocodingPort,
  PropertyRepository,
} from '../ports/index.js';
import { isMailable } from '@domain/scoring/value-objects/GeoPrecision.js';

export interface SyncDpeBatchResult {
  readonly fetched: number;
  readonly ingested: number;
  readonly duplicates: number;
  readonly ungeocodable: number;
  /** Lignes resolues sans appel au geocodeur externe. */
  readonly geocodeCallsSaved: number;
}

/**
 * Radar DPE — synchronisation horaire des nouveaux diagnostics.
 *
 * Trois exigences portent ce cas d'usage :
 *  - deduplication stricte par numero de DPE (l'ADEME republie),
 *  - journalisation de chaque rejet avec sa cause (tracabilite RGPD),
 *  - aucune interruption sur un enregistrement isole en erreur : un DPE
 *    malforme ne doit pas faire tomber le batch horaire.
 */
export class SyncDpeBatch {
  constructor(
    private readonly source: DpeSourcePort,
    private readonly geocoder: GeocodingPort,
    private readonly properties: PropertyRepository,
    private readonly audit: AuditLogPort,
    private readonly clock: Clock,
  ) {}

  async execute(since: Date, maxPages = 20): Promise<SyncDpeBatchResult> {
    let fetched = 0;
    let ingested = 0;
    let duplicates = 0;
    let ungeocodable = 0;
    let geocodeCallsSaved = 0;
    let cursor: string | undefined;

    for (let page = 0; page < maxPages; page += 1) {
      const { records, nextCursor } = await this.source.fetchSince(since, cursor);
      fetched += records.length;

      for (const record of records) {
        const now = this.clock.now();

        if (await this.properties.hasDpe(record.dpeNumber)) {
          duplicates += 1;
          await this.audit.record(
            { type: 'DPE_SKIPPED', dpeNumber: record.dpeNumber, cause: 'duplicate' },
            now,
          );
          continue;
        }

        const embedded = embeddedGeocode(record);
        if (embedded) geocodeCallsSaved += 1;

        const geo =
          embedded ?? (await this.geocoder.geocode(record.rawAddress, record.inseeCode));
        if (!geo) {
          ungeocodable += 1;
          await this.audit.record(
            { type: 'DPE_SKIPPED', dpeNumber: record.dpeNumber, cause: 'ungeocodable' },
            now,
          );
          continue;
        }

        await this.properties.upsertFromDpe(record, geo);
        ingested += 1;
        await this.audit.record({ type: 'DPE_INGESTED', dpeNumber: record.dpeNumber }, now);
      }

      if (!nextCursor || records.length === 0) break;
      cursor = nextCursor;
    }

    return { fetched, ingested, duplicates, ungeocodable, geocodeCallsSaved };
  }
}

/**
 * Reutilise le geocodage fourni par l'ADEME lorsqu'il est assez precis pour
 * un courrier adresse. En deca, on repasse par la BAN : une adresse a la rue
 * ne sert ni au ciblage, ni a la jointure DVF.
 *
 * Les coordonnees ne sont pas dans le jeu selectionne ; elles sont resolues
 * par le geocodeur au moment ou l'on en a besoin (carte). On stocke 0/0 comme
 * marqueur explicite d'absence, jamais comme une position reelle.
 */
function embeddedGeocode(record: DpeRecord): GeocodeResult | null {
  if (!record.embeddedBanId) return null;
  if (!isMailable(record.embeddedPrecision)) return null;
  return {
    banId: record.embeddedBanId,
    inseeCode: record.inseeCode,
    precision: record.embeddedPrecision,
    latitude: 0,
    longitude: 0,
    section: null,
  };
}
