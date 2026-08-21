import type { OutreachDraftPort } from '@application/use-cases/PrepareOutreach.js';
import type { OutreachChannel } from '@domain/compliance/OutreachPolicy.js';
import type { DataControllerIdentity } from '@domain/compliance/Article14Notice.js';
import type { ScoreReason } from '@domain/scoring/entities/OpportunityScore.js';

/**
 * Copilote IA — redaction de l'approche.
 *
 * Trois contraintes structurent cet adaptateur, et elles priment sur la
 * qualite redactionnelle :
 *
 *  1. Le modele ne voit JAMAIS d'adresse ni d'identifiant. Il recoit les
 *     raisons du score, pas le bien. Rien d'identifiant ne sort du systeme
 *     vers un tiers.
 *  2. Le modele ne redige QUE le corps. Le bloc d'information art. 14 est
 *     ajoute et verifie apres coup par le cas d'usage — hors de sa portee.
 *  3. La sortie est validee. Un modele qui promet une vente, affirme detenir
 *     un acquereur ou invente un chiffre expose l'agence : le brouillon est
 *     alors rejete, pas corrige.
 */
export interface OpenAiConfig {
  readonly apiKey: string;
  readonly model: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
}

export const DEFAULT_OPENAI_CONFIG = {
  model: 'gpt-4o-mini',
  baseUrl: 'https://api.openai.com/v1',
} as const;

const CHANNEL_BRIEF: Record<OutreachChannel, string> = {
  POSTAL_MAIL:
    'un courrier postal adresse, ton professionnel et sobre, 120 a 180 mots, sans formule commerciale agressive',
  UNADDRESSED_FLYER:
    'un imprime de secteur non adresse, 60 a 90 mots, sans reference a un logement precis',
  DOOR_TO_DOOR:
    'une trame de prise de contact en porte-a-porte, 5 a 7 phrases courtes, formulees a l’oral',
  EMAIL: 'un email court a un contact ayant consenti, 80 a 120 mots',
  SMS: 'un SMS de 2 phrases maximum a un contact ayant consenti',
  PHONE: 'une trame d’appel a un contact ayant consenti, 5 a 7 phrases',
};

/** Formulations qui exposent l'agence : leur presence invalide le brouillon. */
export const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /\bvotre\s+(bien|maison|appartement)\s+est\s+(a\s+vendre|en\s+vente)\b/i,
  /\bnous\s+savons\s+que\s+vous\s+(vendez|allez\s+vendre|souhaitez\s+vendre)\b/i,
  /\bj[’']?ai\s+(un|des)\s+acquereur/i,
  /\bnous\s+avons\s+(un|des)\s+acheteur/i,
  /\bvente\s+garantie\b/i,
  /\bestimation\s+garantie\b/i,
];

export class OpenAiCopilot implements OutreachDraftPort {
  private readonly config: OpenAiConfig;
  private readonly http: typeof fetch;

  constructor(config: Partial<OpenAiConfig> & { apiKey: string }) {
    this.config = { ...DEFAULT_OPENAI_CONFIG, ...config };
    this.http = config.fetchImpl ?? fetch;
  }

  async draft(input: {
    channel: OutreachChannel;
    reasons: readonly ScoreReason[];
    identity: DataControllerIdentity;
  }): Promise<string> {
    const response = await this.http(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: this.config.model,
        temperature: 0.4,
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: buildUserPrompt(input.channel, input.reasons, input.identity) },
        ],
      }),
    });

    if (!response.ok) {
      throw new CopilotUnavailableError(response.status);
    }

    const body = (await response.json()) as {
      choices?: { message?: { content?: string } }[];
    };
    const content = body.choices?.[0]?.message?.content?.trim();
    if (!content) throw new CopilotUnavailableError(502);

    const violation = findViolation(content);
    if (violation) {
      // On refuse plutot que de corriger : une reecriture automatique masque
      // une derive du modele au lieu de la faire remonter.
      throw new UnsafeDraftError(violation);
    }
    return content;
  }
}

export const SYSTEM_PROMPT = [
  'Tu rediges pour une agence immobiliere francaise qui prend contact avec un proprietaire.',
  '',
  'INTERDICTIONS ABSOLUES :',
  '- Ne jamais affirmer ni sous-entendre que le logement est a vendre, ou que la personne',
  '  veut vendre. Aucune preuve ne le permet.',
  '- Ne jamais pretendre disposer d’un acquereur, ni garantir une vente ou un prix.',
  '- Ne jamais inventer de chiffre, de date ou de statistique.',
  '- Ne jamais mentionner l’origine des donnees : un bloc d’information legal distinct',
  '  s’en charge, et il sera ajoute automatiquement apres ton texte.',
  '',
  'ATTENDU : un texte utile et sobre, qui propose un service (estimation, point de marche)',
  'sans presumer de l’intention de la personne. Tu rediges uniquement le corps du message.',
  'Pas d’objet, pas de signature, pas de mention legale.',
].join('\n');

export function buildUserPrompt(
  channel: OutreachChannel,
  reasons: readonly ScoreReason[],
  identity: DataControllerIdentity,
): string {
  // Les raisons sont transmises en clair MAIS sans aucun element identifiant :
  // ni adresse, ni identifiant BAN, ni coordonnees.
  const context =
    reasons.length > 0
      ? reasons.map((r) => `- ${r.label} (source ${r.source})`).join('\n')
      : '- Aucun element de contexte disponible.';

  return [
    `Canal : ${CHANNEL_BRIEF[channel]}.`,
    `Agence : ${identity.agencyName}.`,
    '',
    'Elements de contexte de marche connus (a utiliser avec prudence, sans en tirer',
    'de conclusion sur les intentions de la personne) :',
    context,
  ].join('\n');
}

export function findViolation(draft: string): string | null {
  for (const pattern of FORBIDDEN_PATTERNS) {
    const match = draft.match(pattern);
    if (match) return match[0];
  }
  return null;
}

export class CopilotUnavailableError extends Error {
  constructor(readonly status: number) {
    super(`Le copilote est indisponible (statut ${status}).`);
    this.name = 'CopilotUnavailableError';
  }
}

export class UnsafeDraftError extends Error {
  constructor(readonly excerpt: string) {
    super(
      `Brouillon rejete : le texte genere contient une affirmation non fondee (« ${excerpt} »).`,
    );
    this.name = 'UnsafeDraftError';
  }
}
