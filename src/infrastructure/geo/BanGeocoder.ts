import type { GeocodeResult, GeocodingPort } from '@application/ports/index.js';
import { fromBanResult } from '@domain/scoring/value-objects/GeoPrecision.js';

/**
 * Adaptateur Base Adresse Nationale (api-adresse.data.gouv.fr).
 *
 * N'est appele qu'en repli : le jeu ADEME porte deja `identifiant_ban` pour la
 * quasi-totalite des lignes geocodees. Ce geocodeur sert aux adresses dont le
 * `statut_geocodage` indique une absence de correspondance.
 *
 * L'API est limitee en debit (usage raisonnable attendu sur un service public) :
 * l'appelant doit lisser ses requetes. Le batch horaire n'en a besoin que pour
 * une minorite d'enregistrements.
 */
export interface BanConfig {
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

interface BanFeature {
  readonly properties?: {
    readonly id?: string;
    readonly citycode?: string;
    readonly type?: string;
    readonly score?: number;
  };
  readonly geometry?: { readonly coordinates?: readonly number[] };
}

interface BanResponse {
  readonly features?: readonly BanFeature[];
}

export class BanGeocoder implements GeocodingPort {
  private readonly baseUrl: string;
  private readonly http: typeof fetch;

  constructor(config: Partial<BanConfig> = {}) {
    this.baseUrl = config.baseUrl ?? 'https://api-adresse.data.gouv.fr';
    this.http = config.fetchImpl ?? fetch;
  }

  async geocode(rawAddress: string, inseeCode: string): Promise<GeocodeResult | null> {
    const params = new URLSearchParams({
      q: rawAddress,
      limit: '1',
      // Contraindre a la commune connue evite les appariements hasardeux entre
      // communes homonymes — frequents en zone rurale.
      citycode: inseeCode,
    });

    const response = await this.http(`${this.baseUrl}/search/?${params.toString()}`, {
      headers: { Accept: 'application/json' },
    });
    if (!response.ok) return null;

    const body = (await response.json()) as BanResponse;
    const feature = body.features?.[0];
    const properties = feature?.properties;
    if (!properties?.id) return null;

    const coordinates = feature?.geometry?.coordinates;
    const longitude = coordinates?.[0];
    const latitude = coordinates?.[1];
    if (typeof longitude !== 'number' || typeof latitude !== 'number') return null;

    return {
      banId: properties.id,
      inseeCode: properties.citycode ?? inseeCode,
      precision: fromBanResult(properties.type ?? '', properties.score ?? 0),
      latitude,
      longitude,
      // La section cadastrale n'est pas fournie par la BAN : elle est resolue
      // separement par l'adaptateur cadastre, ou laissee nulle.
      section: null,
    };
  }
}
