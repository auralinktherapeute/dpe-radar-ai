/**
 * Offres et droits associes.
 *
 * Les droits sont definis dans le domaine, pas cote Stripe. Stripe encaisse ;
 * il ne decide pas de ce qu'une agence a le droit de faire. Cette separation
 * evite le piege classique du SaaS : des regles metier eparpillees entre le
 * catalogue de prix, les webhooks et l'interface, qui finissent par diverger.
 */
export type PlanId = 'STARTER' | 'PRO' | 'RESEAU';

export interface PlanEntitlements {
  readonly id: PlanId;
  readonly label: string;
  /** Communes souscrites. `null` = illimite. */
  readonly maxTerritories: number | null;
  readonly includedSeats: number;
  /** Brouillons du Copilote par mois. `null` = illimite. */
  readonly monthlyDrafts: number | null;
  readonly crmConnectors: boolean;
  readonly networkDashboard: boolean;
  readonly openApi: boolean;
  readonly monthlyPriceEur: number | null;
  readonly extraSeatPriceEur: number | null;
}

export const PLANS: Record<PlanId, PlanEntitlements> = {
  STARTER: {
    id: 'STARTER',
    label: 'Starter',
    maxTerritories: 3,
    includedSeats: 2,
    monthlyDrafts: 20,
    crmConnectors: false,
    networkDashboard: false,
    openApi: false,
    monthlyPriceEur: 149,
    extraSeatPriceEur: 19,
  },
  PRO: {
    id: 'PRO',
    label: 'Pro',
    maxTerritories: 15,
    includedSeats: 6,
    monthlyDrafts: null,
    crmConnectors: true,
    networkDashboard: false,
    openApi: true,
    monthlyPriceEur: 349,
    extraSeatPriceEur: 15,
  },
  RESEAU: {
    id: 'RESEAU',
    label: 'Reseau',
    maxTerritories: null,
    includedSeats: 0,
    monthlyDrafts: null,
    crmConnectors: true,
    networkDashboard: true,
    openApi: true,
    monthlyPriceEur: null,
    extraSeatPriceEur: null,
  },
};

export const TRIAL_DAYS = 30;

export type SubscriptionStatus = 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELED';

export interface Subscription {
  readonly agencyId: string;
  readonly plan: PlanId;
  readonly status: SubscriptionStatus;
  readonly trialEndsAt: Date | null;
  readonly currentPeriodEnd: Date | null;
  readonly extraSeats: number;
}

export type Feature =
  | 'RADAR'
  | 'COPILOTE'
  | 'CRM_CONNECTORS'
  | 'NETWORK_DASHBOARD'
  | 'OPEN_API';

export type EntitlementDecision =
  | { readonly allowed: true }
  | { readonly allowed: false; readonly reason: string; readonly upsell: PlanId | null };

/**
 * Un abonnement impaye ne coupe PAS l'acces immediatement.
 *
 * Une agence dont la carte expire un vendredi ne doit pas perdre son pipeline
 * le lundi : on garde l'acces en lecture et on coupe les actions sortantes.
 * Couper tout revient a punir un incident de paiement comme une resiliation,
 * et c'est le meilleur moyen de transformer un retard en churn.
 */
export const PAST_DUE_GRACE_DAYS = 14;

export class Entitlements {
  constructor(private readonly now: () => Date = () => new Date()) {}

  can(subscription: Subscription, feature: Feature): EntitlementDecision {
    const plan = PLANS[subscription.plan];
    const now = this.now();

    if (subscription.status === 'CANCELED') {
      return { allowed: false, reason: 'Abonnement resilie.', upsell: 'STARTER' };
    }

    if (subscription.status === 'TRIALING' && subscription.trialEndsAt) {
      if (subscription.trialEndsAt.getTime() < now.getTime()) {
        return {
          allowed: false,
          reason: 'La periode d’essai est terminee.',
          upsell: subscription.plan,
        };
      }
    }

    if (subscription.status === 'PAST_DUE') {
      const deadline = subscription.currentPeriodEnd
        ? new Date(subscription.currentPeriodEnd.getTime() + PAST_DUE_GRACE_DAYS * 86_400_000)
        : null;
      const withinGrace = deadline === null || deadline.getTime() > now.getTime();

      if (!withinGrace) {
        return { allowed: false, reason: 'Paiement en echec au-dela du delai de grace.', upsell: null };
      }
      // Pendant la grace : lecture conservee, actions sortantes suspendues.
      if (feature !== 'RADAR') {
        return {
          allowed: false,
          reason: 'Paiement en attente : la consultation reste ouverte, les envois sont suspendus.',
          upsell: null,
        };
      }
      return { allowed: true };
    }

    switch (feature) {
      case 'RADAR':
      case 'COPILOTE':
        return { allowed: true };
      case 'CRM_CONNECTORS':
        return plan.crmConnectors
          ? { allowed: true }
          : { allowed: false, reason: 'Les connecteurs CRM sont inclus a partir de Pro.', upsell: 'PRO' };
      case 'NETWORK_DASHBOARD':
        return plan.networkDashboard
          ? { allowed: true }
          : { allowed: false, reason: 'Le pilotage multi-agences est propre a l’offre Reseau.', upsell: 'RESEAU' };
      case 'OPEN_API':
        return plan.openApi
          ? { allowed: true }
          : { allowed: false, reason: 'L’API ouverte est incluse a partir de Pro.', upsell: 'PRO' };
    }
  }

  /** Une agence peut-elle souscrire une commune de plus ? */
  canAddTerritory(subscription: Subscription, current: number): EntitlementDecision {
    const max = PLANS[subscription.plan].maxTerritories;
    if (max === null || current < max) return { allowed: true };
    return {
      allowed: false,
      reason: `L’offre ${PLANS[subscription.plan].label} couvre ${max} communes.`,
      upsell: subscription.plan === 'STARTER' ? 'PRO' : 'RESEAU',
    };
  }

  seatsAvailable(subscription: Subscription, activeUsers: number): boolean {
    const plan = PLANS[subscription.plan];
    if (plan.maxTerritories === null) return true;
    return activeUsers < plan.includedSeats + subscription.extraSeats;
  }

  monthlyPriceEur(subscription: Subscription): number | null {
    const plan = PLANS[subscription.plan];
    if (plan.monthlyPriceEur === null || plan.extraSeatPriceEur === null) return null;
    return plan.monthlyPriceEur + subscription.extraSeats * plan.extraSeatPriceEur;
  }

  daysLeftInTrial(subscription: Subscription): number | null {
    if (subscription.status !== 'TRIALING' || !subscription.trialEndsAt) return null;
    const ms = subscription.trialEndsAt.getTime() - this.now().getTime();
    return Math.max(0, Math.ceil(ms / 86_400_000));
  }
}
