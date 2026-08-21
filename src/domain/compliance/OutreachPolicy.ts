/**
 * Politique de contact.
 *
 * ── Etat du droit, verifie le 20/08/2026 ──────────────────────────────
 * Le decret du 25 juillet 2026, pris en application de la loi contre toutes
 * les fraudes aux aides publiques, interdit depuis le 11 aout 2026 tout appel
 * de PROSPECTION COMMERCIALE vers un consommateur sans consentement prealable
 * exprès, quel que soit le secteur. Bloctel a cesse. Deux exceptions
 * subsistent : le consentement prealable, et le CONTRAT EN COURS.
 *
 * L'interdiction porte sur l'appel de prospection, non sur la conclusion d'une
 * vente : proposer une estimation ou un mandat entre dans son champ. La
 * nullite du contrat conclu est une consequence, pas le perimetre.
 *
 * ── Decision produit ──────────────────────────────────────────────────
 * Le canal telephone est neanmoins DISPONIBLE, sur decision de l'exploitant.
 * Le mode retenu par chaque agence est explicite, journalise et attache a
 * chaque approche preparee : le produit n'arbitre pas a la place du
 * responsable de traitement, mais il garde la trace de son choix.
 */

export type OutreachChannel =
  | 'POSTAL_MAIL'
  | 'UNADDRESSED_FLYER'
  | 'DOOR_TO_DOOR'
  | 'EMAIL'
  | 'SMS'
  | 'PHONE';

/**
 * Regime applique au canal telephone par une agence.
 *
 * - `CONSENT_REQUIRED` : conforme au regime du 11/08/2026. Consentement
 *   prealable, ou contrat en cours. C'est le reglage recommande.
 * - `AGENCY_RESPONSIBILITY` : l'agence assume l'appel sur interet legitime.
 *   Le produit l'autorise, l'horodate et conserve la mention du regime
 *   revendique dans le journal d'audit.
 */
export type PhonePolicyMode = 'CONSENT_REQUIRED' | 'AGENCY_RESPONSIBILITY';

export type LegalBasis =
  | { readonly kind: 'LEGITIMATE_INTEREST' }
  | {
      readonly kind: 'EXPLICIT_CONSENT';
      readonly grantedAt: Date;
      readonly proofRef: string;
      readonly revokedAt?: Date;
    }
  | { readonly kind: 'EXISTING_CONTRACT'; readonly since: Date };

export interface OutreachFeatureFlags {
  /** Coupe-circuit global. */
  readonly outreachEnabled: boolean;
  readonly phoneChannelEnabled: boolean;
  readonly phonePolicyMode: PhonePolicyMode;
}

export interface OutreachRequest {
  readonly channel: OutreachChannel;
  readonly basis: LegalBasis;
  readonly suppressed: boolean;
  readonly mailable: boolean;
  /** Un numero est-il connu pour ce bien ? (issu de la pige de l'agence) */
  readonly hasPhoneNumber?: boolean;
  readonly flags: OutreachFeatureFlags;
}

export type OutreachDecision =
  | {
      readonly allowed: true;
      readonly requiresArticle14Notice: boolean;
      /** Regime revendique, journalise avec l'approche. */
      readonly basisClaimed: LegalBasis['kind'];
      /** Renseigne quand l'agence engage sa propre responsabilite. */
      readonly agencyLiability?: string;
    }
  | { readonly allowed: false; readonly code: DenialCode; readonly reason: string };

export type DenialCode =
  | 'OUTREACH_DISABLED'
  | 'SUPPRESSED'
  | 'PHONE_REQUIRES_CONSENT'
  | 'PHONE_CHANNEL_DISABLED'
  | 'NO_PHONE_NUMBER'
  | 'ELECTRONIC_REQUIRES_OPT_IN'
  | 'CONSENT_REVOKED'
  | 'NOT_MAILABLE';

const LIABILITY_NOTICE =
  'Appel effectue sur interet legitime, sous la responsabilite de l’agence. ' +
  'Le regime du 11/08/2026 exige en principe un consentement prealable ou un contrat en cours.';

function consentIsValid(basis: LegalBasis, now: Date): boolean {
  if (basis.kind !== 'EXPLICIT_CONSENT') return false;
  if (basis.grantedAt.getTime() > now.getTime()) return false;
  return basis.revokedAt === undefined || basis.revokedAt.getTime() > now.getTime();
}

export class OutreachPolicy {
  constructor(private readonly now: () => Date = () => new Date()) {}

  decide(request: OutreachRequest): OutreachDecision {
    const now = this.now();

    if (!request.flags.outreachEnabled) {
      return {
        allowed: false,
        code: 'OUTREACH_DISABLED',
        reason: 'La generation de messages sortants est desactivee (coupe-circuit global).',
      };
    }

    // L'opposition prime sur toute base legale et sur tout reglage.
    if (request.suppressed && request.channel !== 'UNADDRESSED_FLYER') {
      return {
        allowed: false,
        code: 'SUPPRESSED',
        reason:
          'Cette adresse figure sur la liste de suppression. Aucun contact cible n’est possible, pour aucune agence.',
      };
    }

    switch (request.channel) {
      case 'UNADDRESSED_FLYER':
        return { allowed: true, requiresArticle14Notice: false, basisClaimed: request.basis.kind };

      case 'PHONE':
        return this.decidePhone(request, now);

      case 'EMAIL':
      case 'SMS': {
        if (request.basis.kind === 'EXISTING_CONTRACT') {
          return { allowed: true, requiresArticle14Notice: false, basisClaimed: 'EXISTING_CONTRACT' };
        }
        if (consentIsValid(request.basis, now)) {
          return { allowed: true, requiresArticle14Notice: true, basisClaimed: 'EXPLICIT_CONSENT' };
        }
        if (request.basis.kind === 'EXPLICIT_CONSENT') {
          return {
            allowed: false,
            code: 'CONSENT_REVOKED',
            reason: 'Le consentement a ete revoque ou n’est pas encore effectif.',
          };
        }
        return {
          allowed: false,
          code: 'ELECTRONIC_REQUIRES_OPT_IN',
          reason:
            'La prospection par email ou SMS vers un particulier exige un opt-in prealable (art. L34-5 CPCE).',
        };
      }

      case 'POSTAL_MAIL': {
        if (!request.mailable) {
          return {
            allowed: false,
            code: 'NOT_MAILABLE',
            reason:
              'Le geocodage est trop imprecis pour adresser un courrier (rue ou commune seulement).',
          };
        }
        return { allowed: true, requiresArticle14Notice: true, basisClaimed: request.basis.kind };
      }

      case 'DOOR_TO_DOOR':
        return { allowed: true, requiresArticle14Notice: true, basisClaimed: request.basis.kind };
    }
  }

  private decidePhone(request: OutreachRequest, now: Date): OutreachDecision {
    if (!request.flags.phoneChannelEnabled) {
      return {
        allowed: false,
        code: 'PHONE_CHANNEL_DISABLED',
        reason: 'Le canal telephone est desactive pour cette agence.',
      };
    }

    // On ne prepare pas un appel sans numero : le numero provient de la pige
    // sous licence de l'agence, jamais des donnees publiques ADEME ou DVF.
    if (request.hasPhoneNumber === false) {
      return {
        allowed: false,
        code: 'NO_PHONE_NUMBER',
        reason:
          'Aucun numero connu pour ce bien. Les numeros proviennent du logiciel de pige de l’agence, pas des donnees publiques.',
      };
    }

    // Exception legale n°1 : contrat en cours.
    if (request.basis.kind === 'EXISTING_CONTRACT') {
      return { allowed: true, requiresArticle14Notice: false, basisClaimed: 'EXISTING_CONTRACT' };
    }

    // Exception legale n°2 : consentement prealable exprès.
    if (consentIsValid(request.basis, now)) {
      return { allowed: true, requiresArticle14Notice: true, basisClaimed: 'EXPLICIT_CONSENT' };
    }

    if (request.basis.kind === 'EXPLICIT_CONSENT') {
      return {
        allowed: false,
        code: 'CONSENT_REVOKED',
        reason: 'Le consentement a ete revoque ou n’est pas encore effectif.',
      };
    }

    // Interet legitime : autorise uniquement si l'agence a explicitement
    // choisi d'en assumer la responsabilite.
    if (request.flags.phonePolicyMode === 'AGENCY_RESPONSIBILITY') {
      return {
        allowed: true,
        requiresArticle14Notice: true,
        basisClaimed: 'LEGITIMATE_INTEREST',
        agencyLiability: LIABILITY_NOTICE,
      };
    }

    return {
      allowed: false,
      code: 'PHONE_REQUIRES_CONSENT',
      reason:
        'Regime « consentement requis » actif : l’appel exige un consentement prealable ou un contrat en cours.',
    };
  }

  /**
   * Canaux proposables sur un bien froid.
   * Le telephone n'apparait que si l'agence l'a active, en assume le regime,
   * et dispose d'un numero issu de sa pige.
   */
  availableChannelsForColdProperty(input: {
    readonly mailable: boolean;
    readonly hasPhoneNumber: boolean;
    readonly flags: OutreachFeatureFlags;
  }): OutreachChannel[] {
    const channels: OutreachChannel[] = ['UNADDRESSED_FLYER', 'DOOR_TO_DOOR'];
    if (input.mailable) channels.unshift('POSTAL_MAIL');
    if (
      input.flags.phoneChannelEnabled &&
      input.flags.phonePolicyMode === 'AGENCY_RESPONSIBILITY' &&
      input.hasPhoneNumber
    ) {
      channels.unshift('PHONE');
    }
    return channels;
  }
}
