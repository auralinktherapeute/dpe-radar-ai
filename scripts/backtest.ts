/**
 * Backtest de calibration — sur DONNEES REELLES, sans fuite temporelle.
 *
 *   npx tsx scripts/backtest.ts 33063 [autres codes INSEE...]
 *
 * Protocole (docs/03-modele-de-scoring, s.7) :
 *   1. On se place a T0 = 30/06/2023.
 *   2. Univers : tous les DPE recus AVANT T0 dans la commune.
 *   3. Score calcule avec les SEULES donnees disponibles a T0 — statistiques
 *      DVF arretees a T0, derniere mutation anterieure a T0.
 *   4. Label = 1 si une mutation DVF est observee entre T0 et T0+12 mois.
 *   5. Mesure : lift au decile superieur, AUC, Brier.
 *
 * Le choix de T0 n'est pas arbitraire : il faut que la fenetre d'observation
 * (2023-07 -> 2024-06) soit ENTIEREMENT publiee dans DVF, sans quoi les labels
 * seraient tronques et le modele paraitrait mauvais a tort.
 */
import { AdemeDpeSource } from '../src/infrastructure/ademe/AdemeDpeSource.js';
import { GeoDvfMarketData } from '../src/infrastructure/dvf/GeoDvfMarketData.js';
import { SignalBuilder } from '../src/domain/scoring/services/SignalBuilder.js';
import { IntentScoringService } from '../src/domain/scoring/services/IntentScoringService.js';
import type { PropertyFacts } from '../src/domain/scoring/services/SignalBuilder.js';
import { groupByAddress } from '../src/application/use-cases/RankOpportunities.js';
import { banJoinKey } from '../src/infrastructure/dvf/banKey.js';
import { evaluate } from '../src/domain/calibration/Metrics.js';
import type { Observation } from '../src/domain/calibration/Metrics.js';
import { monthsBetween } from '../src/domain/scoring/signals/normalizers.js';
import { isDvfCovered } from '../src/domain/scoring/value-objects/DvfCoverage.js';

const T0 = new Date('2023-06-30T00:00:00Z');
const WINDOW_END = new Date('2024-06-30T00:00:00Z');
const MAX_PAGES = 30;
const PAGE_SIZE = 500;

const args = process.argv.slice(2);
/**
 * BIAIS MAJEUR, constate au premier passage : mesurer le label a l'ADRESSE
 * est invalide pour les appartements. Un immeuble de vingt logements connait
 * presque toujours une mutation dans l'annee — le label mesure alors la
 * taille de l'immeuble, pas l'intention d'un proprietaire. Premier resultat
 * obtenu ainsi : taux de base 21,5 % (contre ~3 % de rotation reelle du parc),
 * AUC 0,430, lift inverse.
 *
 * On restreint donc aux MAISONS, ou l'adresse correspond au logement. C'est la
 * seule population sur laquelle la cible est correctement observable avec les
 * donnees publiques.
 */
const includeApartments = args.includes('--tous-types');
/** Mesure le pouvoir discriminant de CHAQUE signal, pris isolement. */
const diagnostic = args.includes('--diagnostic');
const communes = args.filter((a) => !a.startsWith('--'));
if (communes.length === 0) communes.push('33063');

async function main(): Promise<void> {
  console.log('\n═══ Backtest de calibration — donnees reelles ═══');
  console.log(`T0 = ${iso(T0)} · fenetre d'observation jusqu'au ${iso(WINDOW_END)}`);
  console.log(
    `Population : ${includeApartments ? 'tous types (label a l’adresse — biaise)' : 'maisons uniquement'}`,
  );
  console.log(`Communes : ${communes.join(', ')}\n`);

  const all: Observation[] = [];

  for (const insee of communes) {
    if (!isDvfCovered(insee)) {
      console.log(`${insee} · hors couverture DVF, aucun label observable — commune ignoree.\n`);
      continue;
    }

    const observations = await backtestCommune(insee);
    all.push(...observations);
  }

  if (all.length === 0) {
    console.log('Aucune observation exploitable.');
    return;
  }

  console.log('\n─── Resultat agrege ───\n');
  report(all);
  if (diagnostic) diagnose();
}

async function backtestCommune(insee: string): Promise<Observation[]> {
  // Statistiques de marche arretees a T0 : aucune donnee posterieure.
  const dvfAtT0 = new GeoDvfMarketData({
    baseUrl: 'https://files.data.gouv.fr/geo-dvf/latest/csv',
    years: [2021, 2022],
    now: () => T0,
  });
  const stats = await dvfAtT0.statsFor(insee);

  // Mutations observees APRES T0 : servent uniquement aux labels.
  const dvfAfter = new GeoDvfMarketData({
    baseUrl: 'https://files.data.gouv.fr/geo-dvf/latest/csv',
    years: [2023, 2024],
    now: () => WINDOW_END,
  });
  const sold = await dvfAfter.mutationsIn(insee, T0, WINDOW_END);

  // Le filtre de type est applique A LA SOURCE. Filtrer apres coup tronquait
  // l'univers sur les DPE les plus recents (15 000 lignes sur 36 099), ce qui
  // supprimait toute variance sur le signal de fraicheur — precisement celui
  // qui pese le plus dans le bareme.
  const ademe = new AdemeDpeSource({
    pageSize: PAGE_SIZE,
    restrictToInsee: [insee],
    sort: 'date_reception_dpe',
    ...(includeApartments ? {} : { buildingTypes: ['maison'] }),
  });

  const records = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const result = await ademe.fetchBefore(T0, cursor);
    records.push(...result.records);
    if (!result.nextCursor || result.records.length === 0) break;
    cursor = result.nextCursor;
  }

  const eligible = records;

  const groups = groupByAddress(eligible);
  const builder = new SignalBuilder();
  const scoring = new IntentScoringService();
  const observations: Observation[] = [];

  for (const group of groups) {
    const banId = group.latest.embeddedBanId;
    if (!banId) continue;

    const lastMutationAt = await dvfAtT0.lastMutationBefore(banId, insee, T0);

    const facts: PropertyFacts = {
      dpe: { dpeClass: group.latest.dpeClass, establishedAt: group.latest.establishedAt },
      ...(stats ? { neighbourhood: stats } : {}),
      ...(lastMutationAt ? { lastMutationAt } : {}),
    };

    const score = scoring.score({
      observations: builder.build(facts, T0),
      geoPrecision: group.latest.embeddedPrecision,
      computedAt: T0,
    });

    // Un bien sans score fiable n'entre pas dans la calibration : on ne
    // calibre pas sur des scores qu'on refuse d'afficher.
    if (score.score === null) continue;

    const key = banJoinKey(banId);
    const label: 0 | 1 = key && sold.has(key) ? 1 : 0;
    observations.push({ score: score.score, label });

    if (diagnostic) {
      details.push({
        label,
        ageMonths: monthsBetween(group.latest.establishedAt, T0),
        dpeClass: group.latest.dpeClass,
        holdingYears: lastMutationAt
          ? monthsBetween(lastMutationAt, T0) / 12
          : null,
      });
    }
  }

  console.log(
    `${insee} · ${records.length} DPE (${eligible.length} retenus) -> ${groups.length} adresses -> ` +
      `${observations.length} scorees · ${observations.filter((o) => o.label === 1).length} mises en vente observees`,
  );
  return observations;
}

interface Detail {
  readonly label: 0 | 1;
  readonly ageMonths: number;
  readonly dpeClass: string;
  readonly holdingYears: number | null;
}

const details: Detail[] = [];

/**
 * Diagnostic par signal.
 *
 * Un score global qui ne discrimine pas peut cacher deux situations tres
 * differentes : soit aucun signal ne porte d'information, soit un signal en
 * porte mais il est noye par les poids. Cette ventilation tranche.
 */
function diagnose(): void {
  if (details.length === 0) return;

  console.log('\n─── Pouvoir discriminant par signal ───\n');

  bucketReport(
    'Anciennete du DPE a T0',
    [
      ['0-3 mois', (d: Detail) => d.ageMonths <= 3],
      ['3-6 mois', (d: Detail) => d.ageMonths > 3 && d.ageMonths <= 6],
      ['6-12 mois', (d: Detail) => d.ageMonths > 6 && d.ageMonths <= 12],
      ['12-18 mois', (d: Detail) => d.ageMonths > 12 && d.ageMonths <= 18],
      ['> 18 mois', (d: Detail) => d.ageMonths > 18],
    ],
  );

  bucketReport('Classe energetique', [
    ['A-B', (d: Detail) => 'AB'.includes(d.dpeClass)],
    ['C', (d: Detail) => d.dpeClass === 'C'],
    ['D', (d: Detail) => d.dpeClass === 'D'],
    ['E', (d: Detail) => d.dpeClass === 'E'],
    ['F', (d: Detail) => d.dpeClass === 'F'],
    ['G', (d: Detail) => d.dpeClass === 'G'],
  ]);

  bucketReport('Duree de detention estimee', [
    ['inconnue', (d: Detail) => d.holdingYears === null],
    ['< 2 ans', (d: Detail) => d.holdingYears !== null && d.holdingYears < 2],
    ['2-7 ans', (d: Detail) => d.holdingYears !== null && d.holdingYears >= 2 && d.holdingYears < 7],
    ['7-12 ans', (d: Detail) => d.holdingYears !== null && d.holdingYears >= 7 && d.holdingYears < 12],
    ['> 12 ans', (d: Detail) => d.holdingYears !== null && d.holdingYears >= 12],
  ]);
}

function bucketReport(title: string, buckets: readonly [string, (d: Detail) => boolean][]): void {
  const base = details.filter((d) => d.label === 1).length / details.length;
  console.log(`${title} (taux de base ${(base * 100).toFixed(1)} %)`);
  for (const [label, predicate] of buckets) {
    const slice = details.filter(predicate);
    if (slice.length === 0) continue;
    const positives = slice.filter((d) => d.label === 1).length;
    const rate = positives / slice.length;
    const lift = base > 0 ? rate / base : 0;
    const bar = '█'.repeat(Math.round(lift * 12));
    console.log(
      `  ${label.padEnd(12)} n=${String(slice.length).padStart(5)}  ` +
        `${(rate * 100).toFixed(1).padStart(5)} %  ${lift.toFixed(2)}x  ${bar}`,
    );
  }
  console.log('');
}

function report(observations: readonly Observation[]): void {
  const result = evaluate(observations);

  console.log(`Observations      ${result.total}`);
  console.log(`Mises en vente    ${result.positives}`);
  console.log(`Taux de base      ${(result.baseRate * 100).toFixed(2)} %`);
  console.log(`AUC               ${result.auc === null ? '—' : result.auc.toFixed(3)}`);
  console.log(`Brier             ${result.brier.toFixed(4)}`);
  console.log(
    `Lift decile 1     ${result.topDecileLift === null ? '—' : `${result.topDecileLift.toFixed(2)}x`}`,
  );
  console.log('');
  console.log('  decile   biens   ventes    taux     lift');
  for (const row of result.deciles) {
    console.log(
      `     ${String(row.decile).padStart(2)}   ${String(row.count).padStart(5)}   ` +
        `${String(row.positives).padStart(6)}  ${(row.rate * 100).toFixed(2).padStart(6)} %  ` +
        `${row.lift.toFixed(2).padStart(6)}x`,
    );
  }
  console.log(`\nVerdict : ${result.verdict}`);
}

function iso(date: Date): string {
  return date.toISOString().slice(0, 10);
}

main().catch((error) => {
  console.error('Echec du backtest :', error);
  process.exit(1);
});
