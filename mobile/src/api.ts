import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * Client de l'API ouverte v1.
 *
 * L'application mobile ne parle PAS a la base : elle consomme la meme API
 * publique que les connecteurs des logiciels d'agence. Une seule surface a
 * securiser, un seul contrat a faire evoluer.
 */
export interface ApiReason {
  readonly libelle: string;
  readonly points: number;
  readonly source: string;
  readonly date_donnee: string;
}

export interface ApiProperty {
  readonly identifiant_ban: string;
  readonly adresse: string;
  readonly classe_dpe: string;
  readonly score: number | null;
  readonly fourchette: { readonly min: number; readonly max: number };
  readonly confiance: number;
  readonly comparabilite: string;
  readonly adressable: boolean;
  readonly diagnostics_a_l_adresse: number;
  readonly raisons: readonly ApiReason[];
  readonly canaux_autorises: readonly string[];
}

export interface RadarPayload {
  readonly commune: string;
  readonly couverture: string | null;
  readonly biens: readonly ApiProperty[];
  readonly bareme: string | null;
}

export interface CachedRadar {
  readonly payload: RadarPayload;
  /** Instant de recuperation : affiche tel quel, jamais masque. */
  readonly fetchedAt: string;
  readonly fromCache: boolean;
}

const CACHE_PREFIX = 'radar:';

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export class RadarClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
  ) {}

  /**
   * Recupere le Radar d'une commune.
   *
   * En cas de perte de reseau — cas courant entre deux rendez-vous — on
   * retombe sur le dernier resultat connu, en le SIGNALANT. Afficher des
   * donnees d'hier comme si elles etaient d'aujourd'hui ferait citer une
   * information perimee en clientele.
   */
  async radar(commune: string): Promise<CachedRadar> {
    try {
      const response = await fetch(`${this.baseUrl}/api/v1/scores?commune=${commune}`, {
        headers: { Authorization: `Bearer ${this.apiKey}` },
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { erreur?: string };
        throw new ApiError(response.status, body.erreur ?? `Erreur ${response.status}`);
      }

      const payload = (await response.json()) as RadarPayload;
      const entry: CachedRadar = {
        payload,
        fetchedAt: new Date().toISOString(),
        fromCache: false,
      };
      await AsyncStorage.setItem(CACHE_PREFIX + commune, JSON.stringify(entry));
      return entry;
    } catch (error) {
      // Une erreur d'authentification ou de quota doit remonter : elle ne se
      // resout pas en montrant des donnees anciennes.
      if (error instanceof ApiError) throw error;

      const cached = await this.readCache(commune);
      if (cached) return { ...cached, fromCache: true };
      throw new ApiError(0, 'Reseau indisponible et aucune donnee en memoire.');
    }
  }

  private async readCache(commune: string): Promise<CachedRadar | null> {
    try {
      const raw = await AsyncStorage.getItem(CACHE_PREFIX + commune);
      return raw ? (JSON.parse(raw) as CachedRadar) : null;
    } catch {
      return null;
    }
  }
}

/** Age d'une donnee, en francais lisible. */
export function formatAge(isoDate: string, now = new Date()): string {
  const minutes = Math.floor((now.getTime() - new Date(isoDate).getTime()) / 60_000);
  if (minutes < 1) return "a l'instant";
  if (minutes < 60) return `il y a ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `il y a ${hours} h`;
  const days = Math.floor(hours / 24);
  return `il y a ${days} j`;
}

const CHANNEL_LABEL: Record<string, string> = {
  PHONE: 'Telephone',
  POSTAL_MAIL: 'Courrier',
  UNADDRESSED_FLYER: 'Boitage',
  DOOR_TO_DOOR: 'Porte-a-porte',
};

export function channelLabel(channel: string): string {
  return CHANNEL_LABEL[channel] ?? channel;
}
