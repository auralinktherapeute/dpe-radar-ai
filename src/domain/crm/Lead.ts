/**
 * Pipeline de mandat.
 *
 * Le CRM de DPE Radar AI ne remplace pas celui de l'agence : il porte le
 * segment que les logiciels de pige ne couvrent pas — de la detection d'un
 * signal jusqu'au rendez-vous. Au-dela, la main passe a Apimo, Hektor ou Netty
 * via les connecteurs.
 */
export const LEAD_STAGES = [
  'A_QUALIFIER',
  'CONTACTE',
  'RDV_PRIS',
  'ESTIMATION',
  'MANDAT_SIGNE',
  'PERDU',
] as const;

export type LeadStage = (typeof LEAD_STAGES)[number];

export const LEAD_OUTCOMES = [
  'MANDAT_OBTENU',
  'VENDU_AILLEURS',
  'PAS_VENDEUR',
  'OPPOSITION',
  'SANS_REPONSE',
] as const;

export type LeadOutcome = (typeof LEAD_OUTCOMES)[number];

export interface Lead {
  readonly id: string;
  readonly agencyId: string;
  readonly banId: string;
  readonly ownerId: string | null;
  readonly stage: LeadStage;
  readonly outcome: LeadOutcome | null;
  /** Score au moment de l'entree dans le pipeline — fige la justification. */
  readonly scoreAtEntry: number | null;
  readonly createdAt: Date;
  readonly updatedAt: Date;
}

/**
 * Transitions autorisees. Un pipeline qui accepte n'importe quel saut produit
 * des statistiques inexploitables : on ne peut plus distinguer un mandat
 * gagne apres un vrai parcours d'un mandat saisi retrospectivement.
 */
const ALLOWED: Record<LeadStage, readonly LeadStage[]> = {
  A_QUALIFIER: ['CONTACTE', 'PERDU'],
  CONTACTE: ['RDV_PRIS', 'PERDU'],
  RDV_PRIS: ['ESTIMATION', 'PERDU'],
  ESTIMATION: ['MANDAT_SIGNE', 'PERDU'],
  MANDAT_SIGNE: [],
  PERDU: ['A_QUALIFIER'],
};

export function canTransition(from: LeadStage, to: LeadStage): boolean {
  return (ALLOWED[from] as readonly string[]).includes(to);
}

export type TransitionResult =
  | { readonly ok: true; readonly lead: Lead }
  | { readonly ok: false; readonly reason: string };

export function transition(lead: Lead, to: LeadStage, at: Date): TransitionResult {
  if (lead.stage === to) {
    return { ok: false, reason: `Le lead est deja au stade ${to}.` };
  }
  if (!canTransition(lead.stage, to)) {
    return {
      ok: false,
      reason: `Transition ${lead.stage} -> ${to} interdite. Etapes possibles : ${
        ALLOWED[lead.stage].join(', ') || 'aucune (stade terminal)'
      }.`,
    };
  }
  return { ok: true, lead: { ...lead, stage: to, updatedAt: at } };
}

/** Un stade terminal ferme le lead : plus aucune approche ne doit partir. */
export function isClosed(lead: Lead): boolean {
  return lead.stage === 'MANDAT_SIGNE' || lead.stage === 'PERDU';
}

/**
 * L'issue OPPOSITION est particuliere : elle declenche l'inscription sur la
 * liste de suppression, qui vaut pour toutes les agences de la plateforme.
 */
export function triggersSuppression(outcome: LeadOutcome): boolean {
  return outcome === 'OPPOSITION';
}
