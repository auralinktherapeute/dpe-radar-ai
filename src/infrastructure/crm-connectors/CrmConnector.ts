/**
 * Connecteurs vers les logiciels d'agence (Apimo, Hektor, Netty...).
 *
 * Position produit : DPE Radar AI ne cherche pas a remplacer le CRM de
 * l'agence. Il couvre le segment amont — du signal au rendez-vous — puis
 * passe la main. Le transfert est donc SORTANT et a sens unique : on pousse un
 * contact qualifie, on ne rapatrie pas le portefeuille de l'agence.
 *
 * Ce choix n'est pas seulement architectural. Importer le fichier clients d'une
 * agence ferait entrer dans le systeme des donnees nominatives que toute
 * l'architecture s'emploie a en tenir dehors.
 */
export type CrmVendor = 'APIMO' | 'HEKTOR' | 'NETTY';

/**
 * Charge utile poussee vers le CRM. Volontairement pauvre : un bien, un score,
 * des raisons. Aucune identite, puisque le systeme n'en detient aucune.
 */
export interface CrmPushPayload {
  readonly externalRef: string;
  readonly address: string;
  readonly inseeCode: string;
  readonly score: number | null;
  readonly confidence: number;
  readonly reasons: readonly string[];
  readonly stage: string;
  readonly sourceLabel: string;
}

export type CrmPushResult =
  | { readonly ok: true; readonly remoteId: string }
  | { readonly ok: false; readonly code: CrmErrorCode; readonly message: string };

export type CrmErrorCode = 'AUTH' | 'RATE_LIMIT' | 'VALIDATION' | 'UNAVAILABLE';

export interface CrmConnectorPort {
  readonly vendor: CrmVendor;
  push(payload: CrmPushPayload): Promise<CrmPushResult>;
}

export interface HttpCrmConfig {
  readonly baseUrl: string;
  readonly apiKey: string;
  readonly fetchImpl?: typeof fetch;
}

/**
 * Adaptateur HTTP generique. Les trois editeurs exposent des API REST par cle,
 * avec des schemas differents : `mapPayload` isole cette variation, et c'est
 * le seul endroit a reecrire pour brancher un nouvel editeur.
 */
export class HttpCrmConnector implements CrmConnectorPort {
  private readonly http: typeof fetch;

  constructor(
    readonly vendor: CrmVendor,
    private readonly config: HttpCrmConfig,
    private readonly mapPayload: (payload: CrmPushPayload) => unknown = defaultMapping,
  ) {
    this.http = config.fetchImpl ?? fetch;
  }

  async push(payload: CrmPushPayload): Promise<CrmPushResult> {
    let response: Response;
    try {
      response = await this.http(`${this.config.baseUrl}/contacts`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(this.mapPayload(payload)),
      });
    } catch {
      // Le CRM d'une agence tombe regulierement. Une panne chez eux ne doit
      // jamais faire echouer notre pipeline : on renvoie une erreur typee,
      // que l'appelant met en file de reessai.
      return { ok: false, code: 'UNAVAILABLE', message: `${this.vendor} est injoignable.` };
    }

    if (response.ok) {
      const body = (await response.json().catch(() => ({}))) as { id?: string };
      return { ok: true, remoteId: body.id ?? payload.externalRef };
    }

    return { ok: false, code: classify(response.status), message: `${this.vendor} a repondu ${response.status}.` };
  }
}

export function classify(status: number): CrmErrorCode {
  if (status === 401 || status === 403) return 'AUTH';
  if (status === 429) return 'RATE_LIMIT';
  if (status >= 400 && status < 500) return 'VALIDATION';
  return 'UNAVAILABLE';
}

export function defaultMapping(payload: CrmPushPayload): unknown {
  return {
    reference: payload.externalRef,
    address: payload.address,
    city_code: payload.inseeCode,
    pipeline_stage: payload.stage,
    source: payload.sourceLabel,
    custom_fields: {
      dpe_radar_score: payload.score,
      dpe_radar_confidence: payload.confidence,
      dpe_radar_reasons: payload.reasons.join(' · '),
    },
  };
}
