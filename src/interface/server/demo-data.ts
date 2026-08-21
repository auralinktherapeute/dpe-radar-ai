import type { Lead } from '@domain/crm/Lead.js';
import type { AlertRule } from '@domain/alerts/AlertRule.js';
import type { OutreachFeatureFlags } from '@domain/compliance/OutreachPolicy.js';

/**
 * Jeu de donnees de demonstration.
 *
 * En production, ces lectures viennent de Prisma. Ici elles permettent de
 * faire tourner l'interface sans base, ce qui garde le projet demarrable en
 * une commande. Aucune de ces valeurs n'est utilisee par le moteur de scoring.
 */
const DAY = 86_400_000;
const NOW = Date.now();

export const DEMO_AGENCY = {
  agencyId: 'a-rhin',
  networkId: 'n-alsace',
  name: 'Agence du Rhin',
  postalAddress: '3 place Kleber, 67000 Strasbourg',
  dpoContact: 'dpo@agence-du-rhin.fr',
  oppositionUrl: 'https://dperadar.ai/opposition',
};

export const DEMO_FLAGS: OutreachFeatureFlags = {
  outreachEnabled: true,
  phoneChannelEnabled: true,
  phonePolicyMode: 'AGENCY_RESPONSIBILITY',
};

function lead(
  id: string,
  stage: Lead['stage'],
  ownerId: string,
  score: number,
  ageDays: number,
  outcome: Lead['outcome'] = null,
): Lead {
  return {
    id,
    agencyId: DEMO_AGENCY.agencyId,
    banId: `67482_${1000 + Number(id.slice(1))}_0000${id.slice(1)}`,
    ownerId,
    stage,
    outcome,
    scoreAtEntry: score,
    createdAt: new Date(NOW - ageDays * DAY),
    updatedAt: new Date(NOW - (ageDays - 2) * DAY),
  };
}

export const DEMO_LEADS: Lead[] = [
  lead('l1', 'A_QUALIFIER', 'u-marie', 86, 3),
  lead('l2', 'A_QUALIFIER', 'u-marie', 79, 5),
  lead('l3', 'A_QUALIFIER', 'u-karim', 74, 6),
  lead('l4', 'CONTACTE', 'u-marie', 81, 12),
  lead('l5', 'CONTACTE', 'u-karim', 77, 14),
  lead('l6', 'CONTACTE', 'u-karim', 71, 18),
  lead('l7', 'RDV_PRIS', 'u-marie', 88, 24),
  lead('l8', 'RDV_PRIS', 'u-karim', 76, 27),
  lead('l9', 'ESTIMATION', 'u-marie', 83, 34),
  lead('l10', 'MANDAT_SIGNE', 'u-marie', 91, 48, 'MANDAT_OBTENU'),
  lead('l11', 'MANDAT_SIGNE', 'u-karim', 84, 55, 'MANDAT_OBTENU'),
  lead('l12', 'PERDU', 'u-karim', 68, 40, 'PAS_VENDEUR'),
  lead('l13', 'PERDU', 'u-marie', 72, 44, 'VENDU_AILLEURS'),
  lead('l14', 'PERDU', 'u-karim', 65, 50, 'SANS_REPONSE'),
];

export const DEMO_TIMINGS = [
  { leadId: 'l7', daysToRdv: 9 },
  { leadId: 'l8', daysToRdv: 14 },
  { leadId: 'l9', daysToRdv: 11 },
  { leadId: 'l10', daysToRdv: 6 },
  { leadId: 'l11', daysToRdv: 17 },
];

export const DEMO_USERS: Record<string, string> = {
  'u-marie': 'Marie Lefevre',
  'u-karim': 'Karim Benali',
};

export const DEMO_RULES: AlertRule[] = [
  {
    id: 'r1',
    agencyId: DEMO_AGENCY.agencyId,
    kind: 'NOUVEAU_SCORE_ELEVE',
    enabled: true,
    inseeCodes: ['67482', '67043'],
    minScore: 75,
    minConfidence: 60,
    dailyCap: 8,
  },
  {
    id: 'r2',
    agencyId: DEMO_AGENCY.agencyId,
    kind: 'PASSOIRE_DETECTEE',
    enabled: true,
    inseeCodes: [],
    minScore: 60,
    minConfidence: 55,
    dailyCap: 5,
  },
  {
    id: 'r3',
    agencyId: DEMO_AGENCY.agencyId,
    kind: 'BAISSE_DE_PRIX',
    enabled: true,
    inseeCodes: [],
    minScore: 0,
    minConfidence: 50,
    dailyCap: 10,
  },
  {
    id: 'r4',
    agencyId: DEMO_AGENCY.agencyId,
    kind: 'SCORE_EN_HAUSSE',
    enabled: false,
    inseeCodes: [],
    minScore: 70,
    minConfidence: 60,
    dailyCap: 4,
  },
];
