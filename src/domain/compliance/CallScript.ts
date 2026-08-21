import type { ScoreReason } from '../scoring/entities/OpportunityScore.js';
import type { DataControllerIdentity } from './Article14Notice.js';
import type { LegalBasis } from './OutreachPolicy.js';

/**
 * Trame d'appel conforme.
 *
 * L'information de l'article 14 doit etre delivree « au plus tard au moment de
 * la premiere communication ». Au telephone, cela veut dire : dans les
 * premieres secondes, avant tout argumentaire — pas en fin d'appel quand la
 * personne a deja raccroche.
 *
 * L'ouverture et la sortie sont donc IMPOSEES par le domaine ; seul le corps
 * est redige par le Copilote. Un negociateur ne peut pas sauter l'annonce.
 */
export interface CallScript {
  /** Phrases obligatoires, dans l'ordre, avant tout argumentaire. */
  readonly opening: readonly string[];
  /** Points d'appui tires du score, a citer avec leur date. */
  readonly talkingPoints: readonly string[];
  /** Reponses aux objections previsibles. */
  readonly objections: readonly { readonly objection: string; readonly response: string }[];
  /** Sortie obligatoire : droit d'opposition, rappele a la fin de l'appel. */
  readonly closing: readonly string[];
}

export function buildCallScript(input: {
  readonly identity: DataControllerIdentity;
  readonly reasons: readonly ScoreReason[];
  readonly basis: LegalBasis;
}): CallScript {
  const { identity, reasons, basis } = input;

  const origin =
    basis.kind === 'EXPLICIT_CONSENT'
      ? 'Vous nous aviez autorises a vous recontacter.'
      : basis.kind === 'EXISTING_CONTRACT'
        ? 'Je vous appelle au titre du dossier que nous suivons ensemble.'
        : 'Je vous appelle a partir de donnees publiques : les diagnostics energetiques publies par l’ADEME et les transactions immobilieres publiees par l’Etat.';

  return {
    opening: [
      `Bonjour, [prenom nom] de ${identity.agencyName}.`,
      origin,
      'Avez-vous un instant ? Sinon je vous rappelle quand cela vous convient.',
    ],
    talkingPoints: reasons.slice(0, 3).map(
      (reason) =>
        `${reason.label} — source ${reason.source}, donnee du ${reason.observedAt.toLocaleDateString('fr-FR')}.`,
    ),
    objections: [
      {
        objection: 'Comment avez-vous eu mon numero ?',
        response:
          'Il provient de notre outil de pige professionnel, sous licence. Je peux vous en donner la reference, et le retirer immediatement si vous le souhaitez.',
      },
      {
        objection: 'Je ne vends pas.',
        response:
          'Je comprends, et je ne le supposais pas. Je vous appelais pour vous proposer un point de marche sur votre secteur, sans engagement. Souhaitez-vous que je n’en reste la ?',
      },
      {
        objection: 'Comment savez-vous que je veux vendre ?',
        response:
          'Je ne le sais pas, et je ne l’affirme pas. Nous suivons des indicateurs publics de marche par quartier — c’est tout ce dont nous disposons.',
      },
      {
        objection: 'Ne me rappelez plus.',
        response:
          'C’est note et applique immediatement. Votre adresse est retiree de nos listes, pour toutes les agences utilisant notre outil. Bonne journee.',
      },
    ],
    closing: [
      'Avant de raccrocher : vous pouvez vous opposer a tout nouveau contact, sans motif.',
      `Il suffit de nous ecrire a ${identity.dpoContact} ou de passer par ${identity.oppositionUrl}.`,
      'Merci de votre temps.',
    ],
  };
}

/**
 * Une objection « ne me rappelez plus » doit declencher l'inscription sur la
 * liste de suppression, pas une simple note dans le CRM.
 */
export const OPPOSITION_TRIGGERS = [
  'ne me rappelez plus',
  'ne me contactez plus',
  'retirez-moi',
  'je m’oppose',
  'je m\'oppose',
] as const;

export function detectsOpposition(transcript: string): boolean {
  const normalized = transcript.toLowerCase();
  return OPPOSITION_TRIGGERS.some((trigger) => normalized.includes(trigger));
}
