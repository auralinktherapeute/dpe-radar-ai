import { AdemeDpeSource } from '@infrastructure/ademe/AdemeDpeSource.js';
import { GeoDvfMarketData } from '@infrastructure/dvf/GeoDvfMarketData.js';
import { SignalBuilder } from '@domain/scoring/services/SignalBuilder.js';
import { IntentScoringService } from '@domain/scoring/services/IntentScoringService.js';
import type { PropertyFacts } from '@domain/scoring/services/SignalBuilder.js';
import { coverageNotice } from '@domain/scoring/value-objects/DvfCoverage.js';
import { OutreachPolicy } from '@domain/compliance/OutreachPolicy.js';
import type { OutreachFeatureFlags } from '@domain/compliance/OutreachPolicy.js';

// Reglage par defaut du Radar en l'absence de pige importee.
const RADAR_FLAGS: OutreachFeatureFlags = {
  outreachEnabled: true,
  phoneChannelEnabled: true,
  phonePolicyMode: 'AGENCY_RESPONSIBILITY',
};
import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';
import { groupByAddress, rankByScore } from '@application/use-cases/RankOpportunities.js';

export interface RadarRow {
  readonly banId: string;
  readonly address: string;
  readonly dpeClass: string;
  readonly score: OpportunityScore;
  readonly topReason: string;
  readonly channels: readonly string[];
  /** Diagnostics recents constates a la meme adresse. */
  readonly dpeCount: number;
}

const CHANNEL_LABEL: Record<string, string> = {
  PHONE: 'telephone',
  POSTAL_MAIL: 'courrier adresse',
  UNADDRESSED_FLYER: 'boitage',
  DOOR_TO_DOOR: 'porte-a-porte',
};

const LOOKBACK_DAYS = 150;
const PAGE_SIZE = 40;

/**
 * Assemblage cote serveur du Radar.
 *
 * En production, cette fonction lit la base (scores deja calcules par le job
 * quotidien). Ici elle interroge directement les sources publiques, ce qui
 * permet de faire tourner l'interface sans base ni cle d'API.
 */
export async function loadRadar(inseeCode: string): Promise<{
  rows: RadarRow[];
  notice: string | null;
  stats: string | null;
}> {
  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

  const ademe = new AdemeDpeSource({
    pageSize: PAGE_SIZE,
    restrictToInsee: [inseeCode],
    sort: '-date_reception_dpe',
  });
  const { records } = await ademe.fetchSince(since);

  const dvf = new GeoDvfMarketData({
    baseUrl: 'https://files.data.gouv.fr/geo-dvf/latest/csv',
    years: [2023, 2024, 2025],
    now: () => now,
  });
  const neighbourhood = await dvf.statsFor(inseeCode);

  const builder = new SignalBuilder();
  const scoring = new IntentScoringService();
  const policy = new OutreachPolicy(() => now);

  // Regroupement a l'adresse AVANT scoring : un immeuble ne doit pas occuper
  // trois lignes du Radar.
  const groups = groupByAddress(records);

  const rows: RadarRow[] = [];
  for (const group of groups) {
    const record = group.latest;
    const banId = record.embeddedBanId;
    const lastMutationAt =
      neighbourhood && banId ? await dvf.lastMutationAt({ banId, inseeCode }) : null;

    const facts: PropertyFacts = {
      dpe: { dpeClass: record.dpeClass, establishedAt: record.establishedAt },
      ...(neighbourhood ? { neighbourhood } : {}),
      ...(lastMutationAt ? { lastMutationAt } : {}),
    };

    const score = scoring.score({
      observations: builder.build(facts, now),
      geoPrecision: record.embeddedPrecision,
      computedAt: now,
    });

    rows.push({
      banId: group.banId,
      dpeCount: group.dpeCount,
      address: record.rawAddress,
      dpeClass: record.dpeClass,
      score,
      topReason: score.reasons[0]?.label ?? 'Aucun signal exploitable',
      channels: policy
        .availableChannelsForColdProperty({
          mailable: score.mailable,
          hasPhoneNumber: false,
          flags: RADAR_FLAGS,
        })
        .map((channel) => CHANNEL_LABEL[channel] ?? channel),
    });
  }

  return {
    rows: rankByScore(rows),
    notice: coverageNotice(inseeCode).message,
    stats: neighbourhood
      ? `${neighbourhood.salesLast12} ventes sur 12 mois (donnees arretees au ${neighbourhood.observedAt.toLocaleDateString('fr-FR')})`
      : null,
  };
}
