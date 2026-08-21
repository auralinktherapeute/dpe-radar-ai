import { computeAgencyKpis, computeByNegotiator } from '@domain/analytics/AgencyKpis.js';
import type { AgencyKpis, NegotiatorRow } from '@domain/analytics/AgencyKpis.js';
import { AccessPolicy } from '@domain/tenancy/AccessPolicy.js';
import type { Principal } from '@domain/tenancy/AccessPolicy.js';
import type { AgencyRepository, LeadRepository } from '../ports/index.js';

export type DashboardOutcome =
  | {
      readonly status: 'OK';
      readonly agencyName: string;
      readonly kpis: AgencyKpis;
      /** Absent en portee reseau : un directeur de reseau voit des agregats. */
      readonly byNegotiator: readonly NegotiatorRow[];
    }
  | { readonly status: 'FORBIDDEN'; readonly reason: string }
  | { readonly status: 'NOT_FOUND' };

/**
 * Tableau de bord d'agence.
 *
 * La portee decide du niveau de detail : un ADMIN_RESEAU consulte les
 * indicateurs d'une agence de son reseau mais n'obtient PAS le detail par
 * negociateur — comparer nominativement les commerciaux d'une autre agence
 * n'entre pas dans ce qu'un reseau a le droit de faire de nos donnees.
 */
export class BuildAgencyDashboard {
  constructor(
    private readonly leads: LeadRepository,
    private readonly agencies: AgencyRepository,
    private readonly access: AccessPolicy = new AccessPolicy(),
  ) {}

  async execute(principal: Principal, agencyId: string): Promise<DashboardOutcome> {
    const agency = await this.agencies.find(agencyId);
    if (!agency) return { status: 'NOT_FOUND' };

    const decision = this.access.canReadAggregate(principal, {
      agencyId: agency.agencyId,
      networkId: agency.networkId,
    });
    if (!decision.granted) return { status: 'FORBIDDEN', reason: decision.reason };

    const all = await this.leads.listByAgency(agencyId);
    const timings = await this.leads.timingsByAgency(agencyId);

    // Un negociateur ne voit que son propre portefeuille.
    const scoped =
      decision.scope === 'OWN_LEADS'
        ? all.filter((lead) => lead.ownerId === principal.userId)
        : all;

    return {
      status: 'OK',
      agencyName: agency.name,
      kpis: computeAgencyKpis(scoped, timings),
      byNegotiator:
        decision.scope === 'AGENCY' ? computeByNegotiator(scoped) : [],
    };
  }
}
