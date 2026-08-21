import type { Lead, LeadStage } from '../crm/Lead.js';
import { LEAD_STAGES } from '../crm/Lead.js';

/**
 * Indicateurs d'agence et de negociateur.
 *
 * Un principe gouverne ce module : ne jamais afficher un taux calcule sur un
 * echantillon trop faible. Un "taux de conversion de 100 %" sur deux leads
 * fait prendre de mauvaises decisions de management — c'est pire que pas
 * d'indicateur du tout.
 */
export const MIN_SAMPLE_FOR_RATE = 10;

export interface FunnelCounts {
  readonly byStage: Readonly<Record<LeadStage, number>>;
  readonly total: number;
}

export interface Rate {
  readonly value: number | null;
  readonly numerator: number;
  readonly denominator: number;
  /** `false` quand l'echantillon est trop faible : l'UI affiche "—". */
  readonly reliable: boolean;
}

export interface AgencyKpis {
  readonly funnel: FunnelCounts;
  readonly contactToRdv: Rate;
  readonly rdvToMandat: Rate;
  readonly globalConversion: Rate;
  /** Delai median entre entree au pipeline et RDV, en jours. */
  readonly medianDaysToRdv: number | null;
  readonly mandatesSigned: number;
}

function rate(numerator: number, denominator: number): Rate {
  if (denominator === 0) {
    return { value: null, numerator, denominator, reliable: false };
  }
  return {
    value: numerator / denominator,
    numerator,
    denominator,
    reliable: denominator >= MIN_SAMPLE_FOR_RATE,
  };
}

export function countFunnel(leads: readonly Lead[]): FunnelCounts {
  const byStage = Object.fromEntries(LEAD_STAGES.map((s) => [s, 0])) as Record<
    LeadStage,
    number
  >;
  for (const lead of leads) byStage[lead.stage] += 1;
  return { byStage, total: leads.length };
}

/** Un lead ayant atteint au moins ce stade, meme s'il l'a depuis depasse. */
function reached(leads: readonly Lead[], stage: LeadStage): number {
  const order = LEAD_STAGES.indexOf(stage);
  return leads.filter((lead) => {
    if (lead.stage === 'PERDU') {
      // Un lead perdu a bien traverse les stades precedents : on s'appuie
      // sur l'issue pour ne pas sous-estimer le haut du funnel.
      return lead.outcome !== null && order <= LEAD_STAGES.indexOf('CONTACTE');
    }
    return LEAD_STAGES.indexOf(lead.stage) >= order;
  }).length;
}

export interface LeadTiming {
  readonly leadId: string;
  readonly daysToRdv: number;
}

export function computeAgencyKpis(
  leads: readonly Lead[],
  timings: readonly LeadTiming[] = [],
): AgencyKpis {
  const contacted = reached(leads, 'CONTACTE');
  const rdv = reached(leads, 'RDV_PRIS');
  const mandates = leads.filter((l) => l.stage === 'MANDAT_SIGNE').length;

  return {
    funnel: countFunnel(leads),
    contactToRdv: rate(rdv, contacted),
    rdvToMandat: rate(mandates, rdv),
    globalConversion: rate(mandates, leads.length),
    medianDaysToRdv: median(timings.map((t) => t.daysToRdv)),
    mandatesSigned: mandates,
  };
}

export function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[middle] as number;
  return ((sorted[middle - 1] as number) + (sorted[middle] as number)) / 2;
}

export interface NegotiatorRow {
  readonly ownerId: string;
  readonly kpis: AgencyKpis;
}

/** Classement par negociateur, leads non assignes exclus. */
export function computeByNegotiator(leads: readonly Lead[]): NegotiatorRow[] {
  const grouped = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (!lead.ownerId) continue;
    const bucket = grouped.get(lead.ownerId) ?? [];
    bucket.push(lead);
    grouped.set(lead.ownerId, bucket);
  }
  return [...grouped.entries()]
    .map(([ownerId, own]) => ({ ownerId, kpis: computeAgencyKpis(own) }))
    .sort((a, b) => b.kpis.mandatesSigned - a.kpis.mandatesSigned);
}
