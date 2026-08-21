import { IntentScoringService } from '@domain/scoring/services/IntentScoringService.js';
import { SignalBuilder } from '@domain/scoring/services/SignalBuilder.js';
import type { PropertyFacts } from '@domain/scoring/services/SignalBuilder.js';
import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';
import type {
  AuditLogPort,
  Clock,
  ListingSourcePort,
  MarketDataPort,
  PropertyKey,
  PropertyRepository,
  ScoreRepository,
  SuppressionListPort,
} from '../ports/index.js';

export type ComputeScoreOutcome =
  | { readonly status: 'SCORED'; readonly score: OpportunityScore }
  | { readonly status: 'SUPPRESSED' }
  | { readonly status: 'UNKNOWN_PROPERTY' };

/**
 * Radar Opportunites — calcul du score d'intention de vente d'un bien.
 *
 * La verification de la liste de suppression intervient AVANT tout calcul :
 * un bien dont le proprietaire s'est oppose ne doit pas etre score, meme
 * pour un usage interne. Ne pas calculer est plus simple a defendre que
 * calculer sans afficher.
 */
export class ComputeOpportunityScore {
  private readonly builder = new SignalBuilder();
  private readonly scoring = new IntentScoringService();

  constructor(
    private readonly properties: PropertyRepository,
    private readonly market: MarketDataPort,
    private readonly listings: ListingSourcePort,
    private readonly suppression: SuppressionListPort,
    private readonly scores: ScoreRepository,
    private readonly audit: AuditLogPort,
    private readonly clock: Clock,
  ) {}

  async execute(key: PropertyKey, dpe?: PropertyFacts['dpe']): Promise<ComputeScoreOutcome> {
    if (await this.suppression.isSuppressed(key)) {
      return { status: 'SUPPRESSED' };
    }

    const property = await this.properties.find(key);
    if (!property) return { status: 'UNKNOWN_PROPERTY' };

    const now = this.clock.now();

    const [stats, lastMutationAt, listing] = await Promise.all([
      this.market.statsFor(key.inseeCode, property.section),
      this.market.lastMutationAt(key),
      this.listings.snapshotFor(key),
    ]);

    const facts: PropertyFacts = {
      ...(dpe ? { dpe } : {}),
      ...(stats ? { neighbourhood: stats } : {}),
      ...(lastMutationAt ? { lastMutationAt } : {}),
      ...(listing ? { listing } : {}),
    };

    const score = this.scoring.score({
      observations: this.builder.build(facts, now),
      geoPrecision: property.precision,
      computedAt: now,
    });

    await this.scores.save(key, score);
    await this.audit.record(
      {
        type: 'SCORE_COMPUTED',
        banId: key.banId,
        scaleVersion: score.scaleVersion,
        score: score.score,
      },
      now,
    );

    return { status: 'SCORED', score };
  }
}
