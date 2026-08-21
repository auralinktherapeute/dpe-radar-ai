import type {
  AuditEvent,
  AuditLogPort,
  Clock,
  DpeRecord,
  DpeSourcePort,
  GeocodeResult,
  GeocodingPort,
  ListingSnapshot,
  ListingSourcePort,
  MarketDataPort,
  NeighbourhoodStats,
  PropertyKey,
  PropertyRepository,
  ScoreRepository,
  StoredProperty,
  SuppressionListPort,
} from '@application/ports/index.js';
import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';
import type { OutreachDraftPort } from '@application/use-cases/PrepareOutreach.js';

export class FixedClock implements Clock {
  constructor(private readonly value: Date) {}
  now(): Date {
    return this.value;
  }
}

export class InMemoryAuditLog implements AuditLogPort {
  readonly events: AuditEvent[] = [];
  async record(event: AuditEvent): Promise<void> {
    this.events.push(event);
  }
  countOf(type: AuditEvent['type']): number {
    return this.events.filter((e) => e.type === type).length;
  }
}

export class FakeDpeSource implements DpeSourcePort {
  constructor(private readonly pages: readonly (readonly DpeRecord[])[]) {}
  async fetchSince(
    _since: Date,
    cursor?: string,
  ): Promise<{ records: readonly DpeRecord[]; nextCursor?: string }> {
    const index = cursor ? Number(cursor) : 0;
    const records = this.pages[index] ?? [];
    const hasNext = index + 1 < this.pages.length;
    return hasNext ? { records, nextCursor: String(index + 1) } : { records };
  }
}

export class FakeGeocoder implements GeocodingPort {
  constructor(private readonly failFor: readonly string[] = []) {}
  async geocode(rawAddress: string, inseeCode: string): Promise<GeocodeResult | null> {
    if (this.failFor.includes(rawAddress)) return null;
    return {
      banId: `ban-${rawAddress.replace(/\s+/g, '-').toLowerCase()}`,
      inseeCode,
      precision: 'HOUSENUMBER',
      latitude: 48.58,
      longitude: 7.75,
      section: 'AB',
    };
  }
}

export class InMemoryPropertyRepository implements PropertyRepository {
  private readonly byBan = new Map<string, StoredProperty>();
  private readonly dpeNumbers = new Set<string>();

  async upsertFromDpe(record: DpeRecord, geo: GeocodeResult): Promise<StoredProperty> {
    this.dpeNumbers.add(record.dpeNumber);
    const stored: StoredProperty = {
      key: { banId: geo.banId, inseeCode: geo.inseeCode },
      latitude: geo.latitude,
      longitude: geo.longitude,
      precision: geo.precision,
      section: geo.section,
    };
    this.byBan.set(geo.banId, stored);
    return stored;
  }

  async hasDpe(dpeNumber: string): Promise<boolean> {
    return this.dpeNumbers.has(dpeNumber);
  }

  async find(key: PropertyKey): Promise<StoredProperty | null> {
    return this.byBan.get(key.banId) ?? null;
  }

  seed(stored: StoredProperty): void {
    this.byBan.set(stored.key.banId, stored);
  }
}

export class FakeMarketData implements MarketDataPort {
  constructor(
    private readonly stats: NeighbourhoodStats | null,
    private readonly mutation: Date | null,
  ) {}
  async statsFor(): Promise<NeighbourhoodStats | null> {
    return this.stats;
  }
  async lastMutationAt(): Promise<Date | null> {
    return this.mutation;
  }
}

export class FakeListingSource implements ListingSourcePort {
  constructor(private readonly snapshot: ListingSnapshot | null) {}
  async snapshotFor(): Promise<ListingSnapshot | null> {
    return this.snapshot;
  }
}

export class InMemorySuppressionList implements SuppressionListPort {
  private readonly suppressed = new Set<string>();
  async isSuppressed(key: PropertyKey): Promise<boolean> {
    return this.suppressed.has(key.banId);
  }
  async suppress(key: PropertyKey): Promise<void> {
    this.suppressed.add(key.banId);
  }
}

export class InMemoryScoreRepository implements ScoreRepository {
  readonly saved: { key: PropertyKey; score: OpportunityScore }[] = [];
  async save(key: PropertyKey, score: OpportunityScore): Promise<void> {
    this.saved.push({ key, score });
  }
}

/** Simule un modele de langage : renvoie un corps de message sans mention legale. */
export class StubDraftGenerator implements OutreachDraftPort {
  calls = 0;
  async draft(): Promise<string> {
    this.calls += 1;
    return 'Bonjour,\n\nVotre quartier connait une forte demande...';
  }
}

export function dpeRecord(overrides: Partial<DpeRecord> = {}): DpeRecord {
  return {
    dpeNumber: '2426E0123456X',
    dpeClass: 'E',
    establishedAt: new Date('2026-06-12T00:00:00Z'),
    rawAddress: '12 rue des Tanneurs',
    inseeCode: '67482',
    surfaceM2: 78,
    buildingType: 'appartement',
    // Par defaut : geocodage ADEME absent, pour que les tests exercent le
    // chemin de repli vers la BAN. Les cas embarques sont explicites.
    embeddedBanId: null,
    embeddedPrecision: 'UNKNOWN',
    ...overrides,
  };
}
