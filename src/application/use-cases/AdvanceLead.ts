import { isClosed, transition, triggersSuppression } from '@domain/crm/Lead.js';
import type { LeadOutcome, LeadStage } from '@domain/crm/Lead.js';
import { AccessPolicy } from '@domain/tenancy/AccessPolicy.js';
import type { Principal } from '@domain/tenancy/AccessPolicy.js';
import type {
  AuditLogPort,
  Clock,
  LeadRepository,
  SuppressionListPort,
} from '../ports/index.js';

export type AdvanceLeadOutcome =
  | { readonly status: 'ADVANCED'; readonly stage: LeadStage }
  | { readonly status: 'REFUSED'; readonly reason: string }
  | { readonly status: 'NOT_FOUND' };

/**
 * Fait progresser un lead dans le pipeline.
 *
 * Deux effets de bord importants sont concentres ici plutot que disperses :
 *  - une issue « OPPOSITION » inscrit l'adresse sur la liste de suppression,
 *    qui vaut pour TOUTES les agences de la plateforme ;
 *  - chaque transition est journalisee, ce qui rend le funnel auditable.
 */
export class AdvanceLead {
  constructor(
    private readonly leads: LeadRepository,
    private readonly suppression: SuppressionListPort,
    private readonly audit: AuditLogPort,
    private readonly clock: Clock,
    private readonly access: AccessPolicy = new AccessPolicy(),
  ) {}

  async execute(input: {
    readonly principal: Principal;
    readonly leadId: string;
    readonly to: LeadStage;
    readonly outcome?: LeadOutcome;
  }): Promise<AdvanceLeadOutcome> {
    const lead = await this.leads.find(input.leadId);
    if (!lead) return { status: 'NOT_FOUND' };

    const decision = this.access.canReadAgencyData(input.principal, {
      agencyId: lead.agencyId,
      networkId: input.principal.networkId,
    });
    if (!decision.granted) return { status: 'REFUSED', reason: decision.reason };

    if (isClosed(lead) && input.to !== 'A_QUALIFIER') {
      return { status: 'REFUSED', reason: 'Ce lead est cloture.' };
    }

    const now = this.clock.now();
    const result = transition(lead, input.to, now);
    if (!result.ok) return { status: 'REFUSED', reason: result.reason };

    await this.leads.save(result.lead);

    if (input.outcome) {
      await this.leads.recordOutcome(lead.id, input.outcome, now);

      if (triggersSuppression(input.outcome)) {
        await this.suppression.suppress(
          { banId: lead.banId, inseeCode: '' },
          'Opposition exprimee par l’occupant',
          now,
        );
      }
    }

    await this.audit.record(
      { type: 'OUTREACH_PREPARED', banId: lead.banId, channel: `stage:${input.to}` },
      now,
    );

    return { status: 'ADVANCED', stage: input.to };
  }
}
