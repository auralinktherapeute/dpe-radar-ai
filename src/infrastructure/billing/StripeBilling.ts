import Stripe from 'stripe';
import { PLANS, TRIAL_DAYS } from '@domain/billing/Plan.js';
import type { PlanId, Subscription, SubscriptionStatus } from '@domain/billing/Plan.js';

/**
 * Adaptateur Stripe.
 *
 * Stripe encaisse ; il ne decide pas des droits. Cet adaptateur traduit
 * l'etat d'abonnement Stripe vers le modele de domaine, et rien de plus :
 * aucune regle metier ne vit ici.
 */
export interface StripeConfig {
  readonly secretKey: string;
  readonly webhookSecret: string;
  readonly priceIds: Readonly<Record<Exclude<PlanId, 'RESEAU'>, string>>;
  readonly extraSeatPriceIds: Readonly<Record<Exclude<PlanId, 'RESEAU'>, string>>;
  readonly successUrl: string;
  readonly cancelUrl: string;
  readonly client?: Stripe;
}

export class StripeBilling {
  private readonly stripe: Stripe;

  constructor(private readonly config: StripeConfig) {
    this.stripe = config.client ?? new Stripe(config.secretKey, { apiVersion: '2025-02-24.acacia' });
  }

  /**
   * Session de souscription, essai de 30 jours sans carte prealable.
   * L'essai est porte par Stripe : une agence qui ne convertit pas n'est
   * jamais prelevee, et on n'a pas de logique d'essai maison a maintenir.
   */
  async createCheckoutSession(input: {
    readonly agencyId: string;
    readonly plan: Exclude<PlanId, 'RESEAU'>;
    readonly extraSeats: number;
    readonly customerEmail: string;
  }): Promise<{ url: string }> {
    const lineItems: Stripe.Checkout.SessionCreateParams.LineItem[] = [
      { price: this.config.priceIds[input.plan], quantity: 1 },
    ];
    if (input.extraSeats > 0) {
      lineItems.push({
        price: this.config.extraSeatPriceIds[input.plan],
        quantity: input.extraSeats,
      });
    }

    const session = await this.stripe.checkout.sessions.create({
      mode: 'subscription',
      line_items: lineItems,
      customer_email: input.customerEmail,
      subscription_data: {
        trial_period_days: TRIAL_DAYS,
        metadata: { agencyId: input.agencyId, plan: input.plan },
      },
      // L'agence est la reference metier : c'est elle qui porte l'abonnement,
      // pas l'utilisateur qui a clique.
      client_reference_id: input.agencyId,
      success_url: this.config.successUrl,
      cancel_url: this.config.cancelUrl,
    });

    if (!session.url) throw new BillingError('Stripe n’a pas renvoye d’URL de paiement.');
    return { url: session.url };
  }

  /** Portail client : changement de carte, resiliation, factures. */
  async createPortalSession(customerId: string, returnUrl: string): Promise<{ url: string }> {
    const session = await this.stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: returnUrl,
    });
    return { url: session.url };
  }

  /** Verifie la signature du webhook avant toute interpretation. */
  verifyWebhook(payload: string, signature: string): Stripe.Event {
    try {
      return this.stripe.webhooks.constructEvent(payload, signature, this.config.webhookSecret);
    } catch {
      throw new BillingError('Signature de webhook Stripe invalide.');
    }
  }
}

/** Evenements Stripe qui modifient les droits d'une agence. */
export const HANDLED_EVENTS = [
  'checkout.session.completed',
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
  'invoice.payment_failed',
] as const;

export function isHandled(type: string): boolean {
  return (HANDLED_EVENTS as readonly string[]).includes(type);
}

/**
 * Traduit un statut Stripe vers le domaine.
 * `incomplete` et `unpaid` sont assimiles a `PAST_DUE` : dans les deux cas,
 * l'agence garde la lecture pendant le delai de grace.
 */
export function toDomainStatus(stripeStatus: string): SubscriptionStatus {
  switch (stripeStatus) {
    case 'trialing':
      return 'TRIALING';
    case 'active':
      return 'ACTIVE';
    case 'past_due':
    case 'unpaid':
    case 'incomplete':
      return 'PAST_DUE';
    default:
      return 'CANCELED';
  }
}

export function toDomainPlan(value: string | undefined): PlanId {
  const upper = value?.toUpperCase();
  return upper && upper in PLANS ? (upper as PlanId) : 'STARTER';
}

export interface SubscriptionUpdate {
  readonly agencyId: string;
  readonly subscription: Subscription;
  readonly stripeCustomerId: string | null;
}

/**
 * Extrait l'etat d'abonnement d'un evenement Stripe.
 * Renvoie `null` si l'evenement ne porte pas d'agence identifiable : mieux
 * vaut ignorer un evenement orphelin que modifier les droits au hasard.
 */
export function readSubscriptionEvent(event: {
  type: string;
  data: { object: Record<string, unknown> };
}): SubscriptionUpdate | null {
  if (!isHandled(event.type)) return null;

  const object = event.data.object;
  const metadata = (object['metadata'] ?? {}) as Record<string, string>;
  const agencyId = metadata['agencyId'] ?? (object['client_reference_id'] as string | undefined);
  if (!agencyId) return null;

  const status = toDomainStatus((object['status'] as string) ?? 'active');
  const trialEnd = object['trial_end'] as number | null | undefined;
  const periodEnd = object['current_period_end'] as number | null | undefined;

  return {
    agencyId,
    stripeCustomerId: (object['customer'] as string | undefined) ?? null,
    subscription: {
      agencyId,
      plan: toDomainPlan(metadata['plan']),
      status: event.type === 'customer.subscription.deleted' ? 'CANCELED' : status,
      trialEndsAt: trialEnd ? new Date(trialEnd * 1000) : null,
      currentPeriodEnd: periodEnd ? new Date(periodEnd * 1000) : null,
      extraSeats: Number(metadata['extraSeats'] ?? 0),
    },
  };
}

export class BillingError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'BillingError';
  }
}
