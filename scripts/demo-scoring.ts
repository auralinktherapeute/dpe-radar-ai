/**
 * Demonstration bout-en-bout sur DONNEES REELLES — aucune valeur simulee.
 *
 *   npx tsx scripts/demo-scoring.ts 33063   # Bordeaux : DVF disponible
 *   npx tsx scripts/demo-scoring.ts 67482   # Strasbourg : hors couverture DVF
 *
 * Chaine : ADEME (diagnostics recents du secteur) -> jointure BAN <-> DVF
 * -> signaux -> score explique -> classement -> canaux autorises.
 */
import { AdemeDpeSource } from '../src/infrastructure/ademe/AdemeDpeSource.js';
import { GeoDvfMarketData } from '../src/infrastructure/dvf/GeoDvfMarketData.js';
import { SignalBuilder } from '../src/domain/scoring/services/SignalBuilder.js';
import { IntentScoringService } from '../src/domain/scoring/services/IntentScoringService.js';
import type { PropertyFacts } from '../src/domain/scoring/services/SignalBuilder.js';
import { coverageNotice } from '../src/domain/scoring/value-objects/DvfCoverage.js';
import { OutreachPolicy } from '../src/domain/compliance/OutreachPolicy.js';
import type { OutreachFeatureFlags } from '../src/domain/compliance/OutreachPolicy.js';

// La demo n'importe aucune pige : aucun numero n'est disponible.
const DEMO_FLAGS: OutreachFeatureFlags = {
  outreachEnabled: true,
  phoneChannelEnabled: true,
  phonePolicyMode: 'AGENCY_RESPONSIBILITY',
};

const insee = process.argv[2] ?? '33063';
const LOOKBACK_DAYS = 150;
const MAX_PROPERTIES = 10;

const now = new Date();
const since = new Date(now.getTime() - LOOKBACK_DAYS * 86_400_000);

async function main(): Promise<void> {
  console.log('\n═══ DPE Radar AI — demonstration sur donnees reelles ═══');
  console.log(`Commune INSEE ${insee} · diagnostics recus depuis ${since.toISOString().slice(0, 10)}\n`);

  const notice = coverageNotice(insee);
  if (!notice.covered) console.log(`⚠ couverture DVF — ${notice.message}\n`);

  // 1. Radar DPE
  const ademe = new AdemeDpeSource({
    pageSize: 200,
    restrictToInsee: [insee],
    sort: '-date_reception_dpe',
  });
  const { records } = await ademe.fetchSince(since);
  const geolocated = records.filter((r) => r.embeddedBanId !== null).length;
  console.log(`ADEME · ${records.length} diagnostics · ${geolocated} deja geocodes a l'adresse`);

  // 2. Radar Quartier
  const dvf = new GeoDvfMarketData({
    baseUrl: 'https://files.data.gouv.fr/geo-dvf/latest/csv',
    years: [2023, 2024, 2025],
    now: () => now,
  });
  const stats = await dvf.statsFor(insee);
  console.log(
    stats
      ? `DVF   · ${stats.salesLast12} ventes sur 12 mois contre ${stats.salesPrevious12} l'annee precedente · ` +
          `prix/m2 ${(stats.pricePerSqmDelta12m * 100).toFixed(1)} %`
      : 'DVF   · indisponible sur ce territoire',
  );

  // 3. Signaux et scoring
  const builder = new SignalBuilder();
  const scoring = new IntentScoringService();
  const policy = new OutreachPolicy(() => now);

  const rows = [];
  for (const record of records.slice(0, MAX_PROPERTIES)) {
    const banId = record.embeddedBanId;
    const lastMutationAt =
      stats && banId ? await dvf.lastMutationAt({ banId, inseeCode: insee }) : null;

    const facts: PropertyFacts = {
      dpe: { dpeClass: record.dpeClass, establishedAt: record.establishedAt },
      ...(stats ? { neighbourhood: stats } : {}),
      ...(lastMutationAt ? { lastMutationAt } : {}),
      listing: { active: false, observedAt: now },
    };

    rows.push({
      record,
      lastMutationAt,
      score: scoring.score({
        observations: builder.build(facts, now),
        geoPrecision: record.embeddedPrecision,
        computedAt: now,
      }),
    });
  }

  rows.sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1));

  // 4. Ce que verrait le negociateur
  console.log(`\n─── Radar Opportunites · ${rows.length} biens classes ───\n`);
  for (const [index, row] of rows.entries()) {
    const value =
      row.score.score === null
        ? `?? [${row.score.range.min}-${row.score.range.max}]`
        : String(row.score.score).padStart(3);

    console.log(
      `${String(index + 1).padStart(2)}. score ${value} · confiance ${String(row.score.confidence).padStart(3)} · ` +
        `${row.score.band.padEnd(11)} · DPE ${row.record.dpeClass} · ${row.record.rawAddress}`,
    );
    for (const reason of row.score.reasons.slice(0, 3)) {
      console.log(
        `     +${reason.contribution.toFixed(1).padStart(5)} pts · ${reason.label} [${reason.source}]`,
      );
    }
    console.log(
      `     canaux autorises : ${policy
        .availableChannelsForColdProperty({
          mailable: row.score.mailable,
          hasPhoneNumber: false,
          flags: DEMO_FLAGS,
        })
        .join(', ')}\n`,
    );
  }

  const matched = rows.filter((r) => r.lastMutationAt).length;
  console.log(`Jointure BAN <-> DVF · ${matched}/${rows.length} biens rattaches a une mutation connue`);
  console.log(
    'Aucun canal telephone, email ou SMS n’est propose sur un bien froid ' +
      '(loi du 11/08/2026 ; art. L34-5 CPCE).\n',
  );
}

main().catch((error) => {
  console.error('Echec de la demonstration :', error);
  process.exit(1);
});
