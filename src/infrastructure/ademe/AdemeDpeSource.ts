import type { DpeRecord, DpeSourcePort } from '@application/ports/index.js';
import { isDpeClass } from '@domain/scoring/value-objects/DpeClass.js';
import type { GeoPrecisionLevel } from '@domain/scoring/value-objects/GeoPrecision.js';

/**
 * Adaptateur ADEME — jeu `dpe03existant` (Observatoire DPE, licence Etalab 2.0).
 *
 * Schema verifie en direct sur l'API le 20/08/2026 : 15 409 991 diagnostics,
 * ~274 000 nouvelles receptions par mois, soit environ 100 par heure au niveau
 * national. Une synchronisation horaire est donc largement dimensionnee.
 *
 * Deux choix issus de l'inspection du schema reel :
 *  - on filtre sur `date_reception_dpe` et non `date_etablissement_dpe` : c'est
 *    la date a laquelle la donnee devient visible, la seule qui garantisse
 *    qu'un incremental ne rate rien ;
 *  - le jeu porte deja `identifiant_ban`, `score_ban` et `statut_geocodage`,
 *    ce qui evite un appel au geocodeur pour la grande majorite des lignes.
 */

export interface AdemeConfig {
  readonly baseUrl: string;
  readonly dataset: string;
  readonly pageSize: number;
  readonly fetchImpl?: typeof fetch;
  /**
   * Restriction au secteur de l'agence (codes INSEE). Une agence achete un
   * territoire, pas la France : filtrer a la source divise le volume par
   * plusieurs ordres de grandeur et evite d'ingerer des donnees personnelles
   * dont on n'a aucun usage — minimisation au sens du RGPD.
   */
  readonly restrictToInsee?: readonly string[];
  /**
   * Ordre de parcours. Le batch incremental trie par reception croissante
   * (pour ne rien rater) ; l'exploration d'un secteur trie a l'inverse.
   */
  readonly sort?: string;
  /**
   * Restriction au type de batiment. Utile au backtest : la cible n'est
   * correctement observable que sur les maisons, ou l'adresse correspond au
   * logement (voir scripts/backtest.ts).
   */
  readonly buildingTypes?: readonly string[];
}

export const DEFAULT_ADEME_CONFIG: AdemeConfig = {
  baseUrl: 'https://data.ademe.fr/data-fair/api/v1/datasets',
  dataset: 'dpe03existant',
  pageSize: 500,
};

/** Champs demandes explicitement : le jeu complet fait plus de 200 colonnes. */
const SELECTED_FIELDS = [
  'numero_dpe',
  'etiquette_dpe',
  'date_etablissement_dpe',
  'date_reception_dpe',
  'adresse_ban',
  'code_insee_ban',
  'identifiant_ban',
  'score_ban',
  'statut_geocodage',
  'surface_habitable_logement',
  'type_batiment',
].join(',');

interface AdemeLine {
  readonly numero_dpe?: string | undefined;
  readonly etiquette_dpe?: string | undefined;
  readonly date_etablissement_dpe?: string | undefined;
  readonly date_reception_dpe?: string | undefined;
  readonly adresse_ban?: string | undefined;
  readonly code_insee_ban?: string | undefined;
  readonly identifiant_ban?: string | undefined;
  readonly score_ban?: number | undefined;
  readonly statut_geocodage?: string | undefined;
  readonly surface_habitable_logement?: number | undefined;
  readonly type_batiment?: string | undefined;
}

interface AdemePage {
  readonly total: number;
  readonly next?: string;
  readonly results: readonly AdemeLine[];
}

/** Donnees de geolocalisation deja presentes dans le jeu ADEME. */
export interface EmbeddedGeo {
  readonly banId: string | null;
  readonly precision: GeoPrecisionLevel;
}

export class AdemeDpeSource implements DpeSourcePort {
  private readonly config: AdemeConfig;
  private readonly http: typeof fetch;

  constructor(config: Partial<AdemeConfig> = {}) {
    this.config = { ...DEFAULT_ADEME_CONFIG, ...config };
    this.http = this.config.fetchImpl ?? fetch;
  }

  async fetchSince(
    since: Date,
    cursor?: string,
  ): Promise<{ records: readonly DpeRecord[]; nextCursor?: string }> {
    // Le curseur est l'URL `next` renvoyee par data-fair : opaque cote domaine,
    // et robuste a la pagination profonde (pas de `from` qui derive).
    const url = cursor ?? this.firstPageUrl(since);

    const response = await this.http(url, {
      headers: { Accept: 'application/json' },
    });

    if (!response.ok) {
      throw new AdemeUnavailableError(response.status, url);
    }

    const page = (await response.json()) as AdemePage;
    const records = page.results
      .map((line) => toDpeRecord(line))
      .filter((record): record is DpeRecord => record !== null);

    return page.next ? { records, nextCursor: page.next } : { records };
  }

  /**
   * Diagnostics recus AVANT une date. Reserve au backtest : constituer un
   * univers a une date passee sans laisser entrer une seule ligne posterieure.
   */
  async fetchBefore(
    before: Date,
    cursor?: string,
  ): Promise<{ records: readonly DpeRecord[]; nextCursor?: string }> {
    const url = cursor ?? this.pageUrl(`date_reception_dpe:[* TO ${toIsoDay(before)}]`);
    const response = await this.http(url, { headers: { Accept: 'application/json' } });
    if (!response.ok) throw new AdemeUnavailableError(response.status, url);

    const page = (await response.json()) as AdemePage;
    const records = page.results
      .map((line) => toDpeRecord(line))
      .filter((record): record is DpeRecord => record !== null);

    return page.next ? { records, nextCursor: page.next } : { records };
  }

  private pageUrl(dateClause: string): string {
    const insee = this.config.restrictToInsee;
    const sector =
      insee && insee.length > 0
        ? ` AND (${insee.map((code) => `code_insee_ban:${code}`).join(' OR ')})`
        : '';
    const types = this.config.buildingTypes;
    const typeClause =
      types && types.length > 0
        ? ` AND (${types.map((t) => `type_batiment:${t}`).join(' OR ')})`
        : '';
    const params = new URLSearchParams({
      size: String(this.config.pageSize),
      select: SELECTED_FIELDS,
      qs: `${dateClause}${sector}${typeClause}`,
      sort: this.config.sort ?? 'date_reception_dpe',
    });
    return `${this.config.baseUrl}/${this.config.dataset}/lines?${params.toString()}`;
  }

  private firstPageUrl(since: Date): string {
    const day = toIsoDay(since);
    const params = new URLSearchParams({
      size: String(this.config.pageSize),
      select: SELECTED_FIELDS,
      qs: buildQuery(day, this.config.restrictToInsee),
      sort: this.config.sort ?? 'date_reception_dpe',
    });
    return `${this.config.baseUrl}/${this.config.dataset}/lines?${params.toString()}`;
  }
}

export function buildQuery(day: string, insee?: readonly string[]): string {
  const dateClause = `date_reception_dpe:[${day} TO *]`;
  if (!insee || insee.length === 0) return dateClause;
  const sector = insee.map((code) => `code_insee_ban:${code}`).join(' OR ');
  return `${dateClause} AND (${sector})`;
}

export class AdemeUnavailableError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
  ) {
    super(`ADEME a repondu ${status} sur ${url}`);
    this.name = 'AdemeUnavailableError';
  }
}

export function toIsoDay(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * Traduit une ligne ADEME en enregistrement de domaine.
 * Renvoie `null` si la ligne est inexploitable : un diagnostic malforme ne
 * doit jamais faire tomber le batch horaire (cf. SyncDpeBatch).
 */
export function toDpeRecord(line: AdemeLine): DpeRecord | null {
  const dpeNumber = line.numero_dpe?.trim();
  const label = line.etiquette_dpe?.trim().toUpperCase();
  const established = line.date_etablissement_dpe ?? line.date_reception_dpe;
  const address = line.adresse_ban?.trim();
  const insee = line.code_insee_ban?.trim();

  if (!dpeNumber || !label || !established || !address || !insee) return null;
  if (!isDpeClass(label)) return null;

  const establishedAt = new Date(`${established}T00:00:00Z`);
  if (Number.isNaN(establishedAt.getTime())) return null;

  const geo = embeddedGeo(line);

  return {
    dpeNumber,
    dpeClass: label,
    establishedAt,
    rawAddress: address,
    inseeCode: insee,
    surfaceM2: typeof line.surface_habitable_logement === 'number'
      ? line.surface_habitable_logement
      : null,
    buildingType: toBuildingType(line.type_batiment),
    embeddedBanId: geo.banId,
    embeddedPrecision: geo.precision,
  };
}

/**
 * Un identifiant BAN vaut {INSEE}_{voie}_{numero sur 5}. Un numero a zero
 * signale une voie entiere, pas un logement.
 */
export function hasHouseNumber(banId: string): boolean {
  const parts = banId.split('_');
  if (parts.length !== 3) return false;
  const number = parts[2];
  if (!number) return false;
  return /^\d+$/.test(number) && Number(number) > 0;
}

function toBuildingType(value: string | undefined): DpeRecord['buildingType'] {
  switch (value?.toLowerCase()) {
    case 'appartement':
      return 'appartement';
    case 'maison':
      return 'maison';
    case 'immeuble':
      return 'immeuble';
    default:
      return 'inconnu';
  }
}

/**
 * Precision de geocodage deduite du jeu ADEME lui-meme.
 * Le champ `statut_geocodage` ne prend en pratique que deux valeurs :
 * geocodee a l'adresse, ou non geocodee faute de correspondance.
 * On module par `score_ban`, qui reste faible sur certaines adresses rurales.
 */
export function embeddedGeo(line: {
  identifiant_ban?: string | undefined;
  score_ban?: number | undefined;
  statut_geocodage?: string | undefined;
}): EmbeddedGeo {
  const status = line.statut_geocodage?.toLowerCase() ?? '';
  const banId = line.identifiant_ban?.trim() || null;
  const score = line.score_ban ?? 0;

  if (!status.includes("à l'adresse") || !banId) {
    return { banId, precision: 'UNKNOWN' };
  }
  // L'ADEME peut declarer "geocodee a l'adresse" une voie sans numero
  // (constate le 20/08/2026 : "Rue de la Krutenau 67000 Strasbourg", sans
  // numero, avec un score BAN eleve). On ne peut pas y adresser un courrier :
  // la precision est degradee a la rue quel que soit le score.
  if (!hasHouseNumber(banId)) return { banId, precision: 'STREET' };
  if (score >= 0.6) return { banId, precision: 'HOUSENUMBER' };
  // Score BAN faible : l'appariement est douteux, on ne l'utilisera pas pour
  // un courrier adresse sans repasser par le geocodeur.
  if (score >= 0.4) return { banId, precision: 'STREET' };
  return { banId, precision: 'UNKNOWN' };
}
