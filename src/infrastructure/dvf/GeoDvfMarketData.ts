import type {
  MarketDataPort,
  NeighbourhoodStats,
  PropertyKey,
} from '@application/ports/index.js';
import { isDvfCovered } from '@domain/scoring/value-objects/DvfCoverage.js';
import { banJoinKey, dvfJoinKey } from './banKey.js';
import { parseCsv } from './csv.js';

/**
 * Adaptateur DVF sur les exports communaux de geo-dvf (files.data.gouv.fr).
 *
 * Choix d'architecture : DVF est un stock annuel, pas un flux. On charge les
 * fichiers communaux par annee et on les met en cache. En production, ce
 * chargement alimente une table Postgres via un job trimestriel ; cet
 * adaptateur en memoire sert au backtest et aux petits volumes.
 *
 * Sur les departements 57/67/68/976, l'adaptateur renvoie `null` sans requete
 * reseau : DVF n'y publie rien (voir DvfCoverage).
 */
export interface Mutation {
  readonly mutationId: string;
  readonly date: Date;
  readonly joinKey: string | null;
  readonly valeurFonciere: number | null;
  readonly surfaceBati: number | null;
  readonly typeLocal: string;
}

export interface GeoDvfConfig {
  readonly baseUrl: string;
  /** Annees a charger, de la plus ancienne a la plus recente. */
  readonly years: readonly number[];
  readonly fetchImpl?: typeof fetch;
  readonly now?: () => Date;
}

const RESIDENTIAL = new Set(['Appartement', 'Maison']);

export class GeoDvfMarketData implements MarketDataPort {
  private readonly cache = new Map<string, readonly Mutation[]>();
  private readonly http: typeof fetch;
  private readonly now: () => Date;

  constructor(private readonly config: GeoDvfConfig) {
    this.http = config.fetchImpl ?? fetch;
    this.now = config.now ?? (() => new Date());
  }

  async statsFor(inseeCode: string): Promise<NeighbourhoodStats | null> {
    const mutations = await this.load(inseeCode);
    if (!mutations) return null;

    // PIEGE MAJEUR, constate sur donnees reelles le 20/08/2026 :
    // DVF est publie avec plusieurs mois de retard. Ancrer les fenetres sur
    // la date du jour compare un dernier exercice TRONQUE a un exercice
    // complet, et fait lire un effondrement du marche partout en France
    // (Bordeaux : 1878 ventes "sur 12 mois" contre 4660 l'annee precedente,
    // alors que rien ne s'est effondre).
    //
    // On ancre donc les fenetres sur la derniere mutation reellement publiee.
    // La latence n'est pas masquee pour autant : `observedAt` porte cette
    // date, et le calcul de fraicheur fait baisser la confiance en consequence.
    const asOf = latestMutationDate(mutations) ?? this.now();
    const oneYearAgo = shiftMonths(asOf, -12);
    const twoYearsAgo = shiftMonths(asOf, -24);

    const recent = mutations.filter((m) => m.date >= oneYearAgo && m.date <= asOf);
    const previous = mutations.filter((m) => m.date >= twoYearsAgo && m.date < oneYearAgo);

    // Sans historique exploitable, on ne fabrique pas d'indicateur.
    if (recent.length === 0 && previous.length === 0) return null;

    const recentPrice = medianPricePerSqm(recent);
    const previousPrice = medianPricePerSqm(previous);
    const delta =
      recentPrice !== null && previousPrice !== null && previousPrice > 0
        ? recentPrice / previousPrice - 1
        : 0;

    return {
      salesLast12: countDistinctMutations(recent),
      salesPrevious12: countDistinctMutations(previous),
      pricePerSqmDelta12m: delta,
      // Date des donnees, pas de l'execution : c'est elle qui doit peser sur
      // la confiance du score.
      observedAt: asOf,
    };
  }

  /**
   * Derniere mutation connue a l'adresse exacte, via la jointure BAN <-> DVF.
   * Renvoie `null` si l'adresse n'apparait dans aucune mutation : c'est le
   * cas nominal (la plupart des biens n'ont pas mute sur la periode chargee),
   * et le signal de duree de detention sera simplement absent.
   */
  async lastMutationAt(key: PropertyKey): Promise<Date | null> {
    const mutations = await this.load(key.inseeCode);
    if (!mutations) return null;

    const target = banJoinKey(key.banId);
    if (!target) return null;

    let latest: Date | null = null;
    for (const mutation of mutations) {
      if (mutation.joinKey !== target) continue;
      if (!latest || mutation.date > latest) latest = mutation.date;
    }
    return latest;
  }

  /**
   * Mutations d'une commune sur une fenetre donnee, indexees par cle de
   * jointure. Utilise par le backtest pour constituer les labels observes.
   */
  async mutationsIn(
    inseeCode: string,
    from: Date,
    to: Date,
  ): Promise<ReadonlySet<string>> {
    const mutations = await this.load(inseeCode);
    const keys = new Set<string>();
    if (!mutations) return keys;
    for (const mutation of mutations) {
      if (mutation.date < from || mutation.date > to) continue;
      if (mutation.joinKey) keys.add(mutation.joinKey);
    }
    return keys;
  }

  /** Derniere mutation a l'adresse ANTERIEURE a une date donnee (anti-fuite). */
  async lastMutationBefore(banId: string, inseeCode: string, before: Date): Promise<Date | null> {
    const mutations = await this.load(inseeCode);
    if (!mutations) return null;
    const target = banJoinKey(banId);
    if (!target) return null;

    let latest: Date | null = null;
    for (const mutation of mutations) {
      if (mutation.joinKey !== target) continue;
      if (mutation.date >= before) continue;
      if (!latest || mutation.date > latest) latest = mutation.date;
    }
    return latest;
  }

  private async load(inseeCode: string): Promise<readonly Mutation[] | null> {
    if (!isDvfCovered(inseeCode)) return null;

    const cached = this.cache.get(inseeCode);
    if (cached) return cached;

    const department = inseeCode.slice(0, 2);
    const all: Mutation[] = [];

    for (const year of this.config.years) {
      const url = `${this.config.baseUrl}/${year}/communes/${department}/${inseeCode}.csv`;
      const response = await this.http(url);
      // Une commune sans transaction sur une annee donnee renvoie 404 :
      // ce n'est pas une erreur, on passe a l'annee suivante.
      if (!response.ok) continue;
      all.push(...toMutations(await response.text()));
    }

    if (all.length === 0) return null;
    this.cache.set(inseeCode, all);
    return all;
  }
}

export function toMutations(csv: string): Mutation[] {
  const mutations: Mutation[] = [];
  for (const row of parseCsv(csv)) {
    const typeLocal = row['type_local'] ?? '';
    if (!RESIDENTIAL.has(typeLocal)) continue;

    const rawDate = row['date_mutation'];
    if (!rawDate) continue;
    const date = new Date(`${rawDate}T00:00:00Z`);
    if (Number.isNaN(date.getTime())) continue;

    mutations.push({
      mutationId: row['id_mutation'] ?? `${rawDate}-${mutations.length}`,
      date,
      joinKey: dvfJoinKey(
        row['code_commune'] ?? '',
        row['adresse_code_voie'] ?? '',
        row['adresse_numero'] ?? '',
      ),
      valeurFonciere: toNumber(row['valeur_fonciere']),
      surfaceBati: toNumber(row['surface_reelle_bati']),
      typeLocal,
    });
  }
  return mutations;
}

/**
 * Une mutation peut couvrir plusieurs lots (donc plusieurs lignes CSV).
 * Compter les lignes surestimerait le volume de ventes de 20 a 40 %.
 */
function countDistinctMutations(mutations: readonly Mutation[]): number {
  return new Set(mutations.map((m) => m.mutationId)).size;
}

function medianPricePerSqm(mutations: readonly Mutation[]): number | null {
  const values: number[] = [];
  for (const m of mutations) {
    if (!m.valeurFonciere || !m.surfaceBati || m.surfaceBati < 9) continue;
    const perSqm = m.valeurFonciere / m.surfaceBati;
    // Bornes anti-aberrations : ventes en viager, cessions intrafamiliales,
    // erreurs de saisie. La mediane seule ne suffit pas sur petits volumes.
    if (perSqm < 200 || perSqm > 30_000) continue;
    values.push(perSqm);
  }
  if (values.length === 0) return null;
  values.sort((a, b) => a - b);
  const middle = Math.floor(values.length / 2);
  if (values.length % 2 === 1) return values[middle] as number;
  return (((values[middle - 1] as number) + (values[middle] as number)) / 2);
}

function toNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Derniere mutation effectivement publiee : borne haute reelle des donnees. */
export function latestMutationDate(mutations: readonly Mutation[]): Date | null {
  let latest: Date | null = null;
  for (const mutation of mutations) {
    if (!latest || mutation.date > latest) latest = mutation.date;
  }
  return latest;
}

export function shiftMonths(date: Date, months: number): Date {
  const shifted = new Date(date.getTime());
  shifted.setUTCMonth(shifted.getUTCMonth() + months);
  return shifted;
}
