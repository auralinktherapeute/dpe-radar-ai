import { describe, expect, it } from 'vitest';
import { canTransition, isClosed, transition, triggersSuppression } from '@domain/crm/Lead.js';
import type { Lead } from '@domain/crm/Lead.js';
import { AccessPolicy } from '@domain/tenancy/AccessPolicy.js';
import type { Principal } from '@domain/tenancy/AccessPolicy.js';
import {
  MIN_SAMPLE_FOR_RATE,
  computeAgencyKpis,
  computeByNegotiator,
  median,
} from '@domain/analytics/AgencyKpis.js';

const NOW = new Date('2026-08-20T09:00:00Z');

function lead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'l1',
    agencyId: 'a1',
    banId: '33063_9315_00051',
    ownerId: 'u1',
    stage: 'A_QUALIFIER',
    outcome: null,
    scoreAtEntry: 78,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe('pipeline de mandat', () => {
  it('suit l’ordre du parcours commercial', () => {
    expect(canTransition('A_QUALIFIER', 'CONTACTE')).toBe(true);
    expect(canTransition('CONTACTE', 'RDV_PRIS')).toBe(true);
    expect(canTransition('ESTIMATION', 'MANDAT_SIGNE')).toBe(true);
  });

  it('interdit les sauts d’etape — sinon les statistiques n’ont plus de sens', () => {
    const result = transition(lead(), 'MANDAT_SIGNE', NOW);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('interdite');
  });

  it('autorise l’abandon depuis n’importe quel stade actif', () => {
    for (const stage of ['A_QUALIFIER', 'CONTACTE', 'RDV_PRIS', 'ESTIMATION'] as const) {
      expect(canTransition(stage, 'PERDU')).toBe(true);
    }
  });

  it('refuse une transition vers le stade courant', () => {
    const result = transition(lead({ stage: 'CONTACTE' }), 'CONTACTE', NOW);
    expect(result.ok).toBe(false);
  });

  it('traite le mandat signe comme terminal', () => {
    expect(isClosed(lead({ stage: 'MANDAT_SIGNE' }))).toBe(true);
    expect(canTransition('MANDAT_SIGNE', 'PERDU')).toBe(false);
  });

  it('permet de rouvrir un lead perdu', () => {
    const result = transition(lead({ stage: 'PERDU' }), 'A_QUALIFIER', NOW);
    expect(result.ok).toBe(true);
  });

  it('ne declenche la suppression que sur une opposition', () => {
    expect(triggersSuppression('OPPOSITION')).toBe(true);
    expect(triggersSuppression('PAS_VENDEUR')).toBe(false);
    expect(triggersSuppression('MANDAT_OBTENU')).toBe(false);
  });
});

describe('cloisonnement multi-agences', () => {
  const policy = new AccessPolicy();
  const directeur: Principal = {
    userId: 'u1',
    agencyId: 'a1',
    networkId: 'n1',
    role: 'DIRECTEUR',
  };
  const adminReseau: Principal = { ...directeur, userId: 'u2', role: 'ADMIN_RESEAU' };
  const negociateur: Principal = { ...directeur, userId: 'u3', role: 'NEGOCIATEUR' };

  it('limite un negociateur a son propre portefeuille', () => {
    const decision = policy.canReadAgencyData(negociateur, { agencyId: 'a1', networkId: 'n1' });
    expect(decision).toEqual({ granted: true, scope: 'OWN_LEADS' });
  });

  it('donne au directeur la vue de son agence', () => {
    const decision = policy.canReadAgencyData(directeur, { agencyId: 'a1', networkId: 'n1' });
    expect(decision).toEqual({ granted: true, scope: 'AGENCY' });
  });

  it('refuse le detail nominatif d’une agence sœur du meme reseau', () => {
    const decision = policy.canReadAgencyData(adminReseau, { agencyId: 'a2', networkId: 'n1' });
    expect(decision.granted).toBe(false);
    if (!decision.granted) expect(decision.reason).toContain('agregats');
  });

  it('autorise l’admin reseau sur les agregats d’une agence du reseau', () => {
    const decision = policy.canReadAggregate(adminReseau, { agencyId: 'a2', networkId: 'n1' });
    expect(decision).toEqual({ granted: true, scope: 'NETWORK_AGGREGATE' });
  });

  it('bloque tout acces hors reseau', () => {
    expect(policy.canReadAggregate(adminReseau, { agencyId: 'a9', networkId: 'n9' }).granted).toBe(false);
    expect(policy.canReadAggregate(directeur, { agencyId: 'a2', networkId: 'n1' }).granted).toBe(false);
  });

  it('reserve la reassignation et le coupe-circuit a l’encadrement', () => {
    expect(policy.canReassignLead(negociateur)).toBe(false);
    expect(policy.canReassignLead(directeur)).toBe(true);
    expect(policy.canToggleOutreach(negociateur)).toBe(false);
    expect(policy.canToggleOutreach(adminReseau)).toBe(true);
  });
});

describe('indicateurs d’agence', () => {
  it('marque un taux non fiable sous l’echantillon minimal', () => {
    const leads = [lead({ id: '1', stage: 'RDV_PRIS' }), lead({ id: '2', stage: 'CONTACTE' })];
    const kpis = computeAgencyKpis(leads);
    // Un "taux de 50 %" sur deux leads fait prendre de mauvaises decisions.
    expect(kpis.contactToRdv.reliable).toBe(false);
    expect(kpis.contactToRdv.value).not.toBeNull();
  });

  it('devient fiable a partir du seuil declare', () => {
    const leads = Array.from({ length: MIN_SAMPLE_FOR_RATE }, (_, i) =>
      lead({ id: `l${i}`, stage: i < 4 ? 'RDV_PRIS' : 'CONTACTE' }),
    );
    expect(computeAgencyKpis(leads).contactToRdv.reliable).toBe(true);
  });

  it('renvoie null plutot que NaN sur un denominateur vide', () => {
    const kpis = computeAgencyKpis([]);
    expect(kpis.contactToRdv.value).toBeNull();
    expect(kpis.globalConversion.value).toBeNull();
    expect(kpis.medianDaysToRdv).toBeNull();
  });

  it('compte les mandats signes et alimente le funnel', () => {
    const leads = [
      lead({ id: '1', stage: 'MANDAT_SIGNE' }),
      lead({ id: '2', stage: 'MANDAT_SIGNE' }),
      lead({ id: '3', stage: 'PERDU', outcome: 'SANS_REPONSE' }),
    ];
    const kpis = computeAgencyKpis(leads);
    expect(kpis.mandatesSigned).toBe(2);
    expect(kpis.funnel.total).toBe(3);
    expect(kpis.funnel.byStage.MANDAT_SIGNE).toBe(2);
  });

  it('classe les negociateurs et ecarte les leads non assignes', () => {
    const leads = [
      lead({ id: '1', ownerId: 'u1', stage: 'MANDAT_SIGNE' }),
      lead({ id: '2', ownerId: 'u2', stage: 'CONTACTE' }),
      lead({ id: '3', ownerId: null, stage: 'MANDAT_SIGNE' }),
    ];
    const rows = computeByNegotiator(leads);
    expect(rows).toHaveLength(2);
    expect(rows[0]?.ownerId).toBe('u1');
  });

  it('calcule une mediane sur nombre pair et impair', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
  });
});
