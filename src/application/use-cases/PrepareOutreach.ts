import { OutreachPolicy } from '@domain/compliance/OutreachPolicy.js';
import type {
  LegalBasis,
  OutreachChannel,
  OutreachFeatureFlags,
} from '@domain/compliance/OutreachPolicy.js';
import {
  buildArticle14Notice,
  containsArticle14Notice,
} from '@domain/compliance/Article14Notice.js';
import type { DataControllerIdentity } from '@domain/compliance/Article14Notice.js';
import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';
import type { AuditLogPort, Clock, PropertyKey, SuppressionListPort } from '../ports/index.js';

/** Port de generation : implemente par l'adaptateur OpenAI. */
export interface OutreachDraftPort {
  draft(input: {
    readonly channel: OutreachChannel;
    readonly reasons: OpportunityScore['reasons'];
    readonly identity: DataControllerIdentity;
  }): Promise<string>;
}

export type PrepareOutreachOutcome =
  | {
      readonly status: 'READY';
      readonly channel: OutreachChannel;
      readonly message: string;
      /** Base legale revendiquee, conservee avec l'approche. */
      readonly basisClaimed: string;
      /** Mention de responsabilite quand l'agence assume l'appel. */
      readonly agencyLiability?: string;
    }
  | { readonly status: 'REFUSED'; readonly code: string; readonly reason: string };

/**
 * Copilote IA — preparation d'une approche conforme.
 *
 * Deux garanties, dans cet ordre :
 *  1. la politique de contact decide AVANT toute generation — on n'appelle
 *     pas le modele pour un canal qu'on n'a pas le droit d'utiliser ;
 *  2. le bloc d'information art. 14 est concatene APRES generation et
 *     verifie. Un modele de langage ne peut ni le reecrire, ni l'omettre.
 */
export class PrepareOutreach {
  constructor(
    private readonly drafts: OutreachDraftPort,
    private readonly suppression: SuppressionListPort,
    private readonly audit: AuditLogPort,
    private readonly clock: Clock,
    private readonly policy: OutreachPolicy = new OutreachPolicy(),
  ) {}

  async execute(input: {
    readonly key: PropertyKey;
    readonly channel: OutreachChannel;
    readonly basis: LegalBasis;
    readonly score: OpportunityScore;
    readonly identity: DataControllerIdentity;
    readonly flags: OutreachFeatureFlags;
    /** Un numero issu de la pige de l'agence est-il disponible ? */
    readonly hasPhoneNumber?: boolean;
  }): Promise<PrepareOutreachOutcome> {
    const now = this.clock.now();
    const suppressed = await this.suppression.isSuppressed(input.key);

    const decision = this.policy.decide({
      channel: input.channel,
      basis: input.basis,
      suppressed,
      mailable: input.score.mailable,
      ...(input.hasPhoneNumber !== undefined ? { hasPhoneNumber: input.hasPhoneNumber } : {}),
      flags: input.flags,
    });

    if (!decision.allowed) {
      await this.audit.record(
        { type: 'OUTREACH_DENIED', banId: input.key.banId, code: decision.code },
        now,
      );
      return { status: 'REFUSED', code: decision.code, reason: decision.reason };
    }

    const body = await this.drafts.draft({
      channel: input.channel,
      reasons: input.score.reasons,
      identity: input.identity,
    });

    let message = body;
    if (decision.requiresArticle14Notice) {
      message = `${body}\n\n---\n${buildArticle14Notice(input.identity)}`;

      // Ceinture et bretelles : si le bloc a disparu, on refuse d'expedier.
      if (!containsArticle14Notice(message)) {
        await this.audit.record(
          { type: 'OUTREACH_DENIED', banId: input.key.banId, code: 'NOTICE_MISSING' },
          now,
        );
        return {
          status: 'REFUSED',
          code: 'NOTICE_MISSING',
          reason: 'Le bloc d’information obligatoire est absent du message genere.',
        };
      }
    }

    // Le regime revendique est journalise AVEC l'approche : c'est la piece
    // qui montre sous quel fondement l'agence a decide de prendre contact.
    await this.audit.record(
      {
        type: 'OUTREACH_PREPARED',
        banId: input.key.banId,
        channel: `${input.channel}:${decision.basisClaimed}`,
      },
      now,
    );
    return {
      status: 'READY',
      channel: input.channel,
      message,
      basisClaimed: decision.basisClaimed,
      ...(decision.agencyLiability ? { agencyLiability: decision.agencyLiability } : {}),
    };
  }
}
