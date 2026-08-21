import { describe, expect, it } from 'vitest';
import {
  Entitlements,
  PAST_DUE_GRACE_DAYS,
  PLANS,
  TRIAL_DAYS,
} from '@domain/billing/Plan.js';
import type { Subscription } from '@domain/billing/Plan.js';
import {
  isHandled,
  readSubscriptionEvent,
  toDomainPlan,
  toDomainStatus,
} from '@infrastructure/billing/StripeBilling.js';
import { InMemoryCache, TTL, cacheKey } from '@infrastructure/cache/RedisCache.js';
import {
  ClerkPrincipalResolver,
  isPublicRoute,
} from '@infrastructure/auth/ClerkPrincipal.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const entitlements = new Entitlements(() => NOW);

function sub(overrides: Partial<Subscription> = {}): Subscription {
  return {
    agencyId: 'a1',
    plan: 'PRO',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-09-15T00:00:00Z'),
    extraSeats: 0,
    ...overrides,
  };
}

describe('offres', () => {
  it('somme les sieges additionnels au prix de base', () => {
    expect(entitlements.monthlyPriceEur(sub({ plan: 'PRO', extraSeats: 3 }))).toBe(349 + 45);
    expect(entitlements.monthlyPriceEur(sub({ plan: 'STARTER', extraSeats: 2 }))).toBe(149 + 38);
  });

  it('n’affiche pas de prix pour l’offre Reseau, qui est sur devis', () => {
    expect(entitlements.monthlyPriceEur(sub({ plan: 'RESEAU' }))).toBeNull();
  });

  it('reserve les connecteurs CRM a partir de Pro', () => {
    const starter = entitlements.can(sub({ plan: 'STARTER' }), 'CRM_CONNECTORS');
    expect(starter.allowed).toBe(false);
    if (!starter.allowed) expect(starter.upsell).toBe('PRO');
    expect(entitlements.can(sub({ plan: 'PRO' }), 'CRM_CONNECTORS').allowed).toBe(true);
  });

  it('reserve le pilotage multi-agences a l’offre Reseau', () => {
    expect(entitlements.can(sub({ plan: 'PRO' }), 'NETWORK_DASHBOARD').allowed).toBe(false);
    expect(entitlements.can(sub({ plan: 'RESEAU' }), 'NETWORK_DASHBOARD').allowed).toBe(true);
  });

  it('limite le nombre de communes selon l’offre', () => {
    expect(entitlements.canAddTerritory(sub({ plan: 'STARTER' }), 2).allowed).toBe(true);
    const refus = entitlements.canAddTerritory(sub({ plan: 'STARTER' }), 3);
    expect(refus.allowed).toBe(false);
    if (!refus.allowed) expect(refus.upsell).toBe('PRO');
    // Reseau : illimite.
    expect(entitlements.canAddTerritory(sub({ plan: 'RESEAU' }), 500).allowed).toBe(true);
  });

  it('compte les sieges inclus plus les sieges additionnels', () => {
    expect(entitlements.seatsAvailable(sub({ plan: 'STARTER', extraSeats: 1 }), 2)).toBe(true);
    expect(entitlements.seatsAvailable(sub({ plan: 'STARTER', extraSeats: 1 }), 3)).toBe(false);
  });
});

describe('periode d’essai', () => {
  it('laisse l’acces ouvert pendant l’essai', () => {
    const essai = sub({
      status: 'TRIALING',
      trialEndsAt: new Date(NOW.getTime() + 5 * 86_400_000),
    });
    expect(entitlements.can(essai, 'RADAR').allowed).toBe(true);
    expect(entitlements.daysLeftInTrial(essai)).toBe(5);
  });

  it('ferme l’acces a l’expiration', () => {
    const expire = sub({
      status: 'TRIALING',
      trialEndsAt: new Date(NOW.getTime() - 86_400_000),
    });
    expect(entitlements.can(expire, 'RADAR').allowed).toBe(false);
    expect(entitlements.daysLeftInTrial(expire)).toBe(0);
  });

  it('dure bien 30 jours', () => {
    expect(TRIAL_DAYS).toBe(30);
  });
});

describe('impaye', () => {
  const impaye = sub({ status: 'PAST_DUE', currentPeriodEnd: new Date(NOW.getTime() - 86_400_000) });

  it('conserve la consultation pendant le delai de grace', () => {
    // Une carte qui expire un vendredi ne doit pas couper le pipeline lundi.
    expect(entitlements.can(impaye, 'RADAR').allowed).toBe(true);
  });

  it('suspend les actions sortantes pendant la grace', () => {
    const decision = entitlements.can(impaye, 'COPILOTE');
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.reason).toContain('suspendus');
  });

  it('coupe tout au-dela du delai de grace', () => {
    const perime = sub({
      status: 'PAST_DUE',
      currentPeriodEnd: new Date(NOW.getTime() - (PAST_DUE_GRACE_DAYS + 2) * 86_400_000),
    });
    expect(entitlements.can(perime, 'RADAR').allowed).toBe(false);
  });

  it('coupe immediatement une resiliation', () => {
    expect(entitlements.can(sub({ status: 'CANCELED' }), 'RADAR').allowed).toBe(false);
  });
});

describe('traduction des evenements Stripe', () => {
  it('ne traite que les evenements qui modifient les droits', () => {
    expect(isHandled('customer.subscription.updated')).toBe(true);
    expect(isHandled('charge.refunded')).toBe(false);
  });

  it('assimile incomplete et unpaid a un impaye, pas a une resiliation', () => {
    expect(toDomainStatus('trialing')).toBe('TRIALING');
    expect(toDomainStatus('active')).toBe('ACTIVE');
    expect(toDomainStatus('past_due')).toBe('PAST_DUE');
    expect(toDomainStatus('unpaid')).toBe('PAST_DUE');
    expect(toDomainStatus('incomplete')).toBe('PAST_DUE');
    expect(toDomainStatus('canceled')).toBe('CANCELED');
  });

  it('se rabat sur Starter face a une offre inconnue', () => {
    expect(toDomainPlan('pro')).toBe('PRO');
    expect(toDomainPlan('inexistant')).toBe('STARTER');
    expect(toDomainPlan(undefined)).toBe('STARTER');
  });

  it('lit un abonnement depuis un evenement', () => {
    const update = readSubscriptionEvent({
      type: 'customer.subscription.updated',
      data: {
        object: {
          status: 'active',
          customer: 'cus_1',
          current_period_end: 1_790_000_000,
          metadata: { agencyId: 'a-rhin', plan: 'PRO', extraSeats: '2' },
        },
      },
    });

    expect(update?.agencyId).toBe('a-rhin');
    expect(update?.subscription.plan).toBe('PRO');
    expect(update?.subscription.extraSeats).toBe(2);
    expect(update?.stripeCustomerId).toBe('cus_1');
  });

  it('force la resiliation sur un evenement de suppression', () => {
    const update = readSubscriptionEvent({
      type: 'customer.subscription.deleted',
      data: { object: { status: 'active', metadata: { agencyId: 'a1' } } },
    });
    expect(update?.subscription.status).toBe('CANCELED');
  });

  it('ignore un evenement sans agence identifiable', () => {
    // Mieux vaut ignorer un evenement orphelin que modifier des droits au hasard.
    expect(
      readSubscriptionEvent({
        type: 'customer.subscription.updated',
        data: { object: { status: 'active', metadata: {} } },
      }),
    ).toBeNull();
  });

  it('ignore un evenement hors perimetre', () => {
    expect(
      readSubscriptionEvent({
        type: 'charge.refunded',
        data: { object: { metadata: { agencyId: 'a1' } } },
      }),
    ).toBeNull();
  });
});

describe('cache', () => {
  it('restitue une valeur avant expiration', async () => {
    let clock = 0;
    const cache = new InMemoryCache(() => clock);
    await cache.set('k', { a: 1 }, 10);
    expect(await cache.get('k')).toEqual({ a: 1 });
    clock = 11_000;
    expect(await cache.get('k')).toBeNull();
  });

  it('invalide par motif', async () => {
    const cache = new InMemoryCache();
    await cache.set(cacheKey('score', '33063', 'a'), 1, 60);
    await cache.set(cacheKey('score', '33063', 'b'), 2, 60);
    await cache.set(cacheKey('stats', '33063'), 3, 60);

    expect(await cache.invalidate('dpe:score:33063:*')).toBe(2);
    expect(await cache.get(cacheKey('stats', '33063'))).toBe(3);
  });

  it('donne aux statistiques DVF une duree plus longue qu’aux scores', () => {
    // DVF bouge par vagues trimestrielles ; les scores, tous les jours.
    expect(TTL.NEIGHBOURHOOD_STATS).toBeGreaterThan(TTL.SCORE);
  });
});

describe('resolution de l’utilisateur', () => {
  const resolver = (membership: Parameters<typeof Object>[0] | null) =>
    new ClerkPrincipalResolver({
      async findMembership() {
        return membership as never;
      },
    });

  it('refuse un acces sans session', async () => {
    expect((await resolver(null).resolve(null)).status).toBe('ANONYMOUS');
  });

  it('refuse un compte valide mais sans rattachement metier', async () => {
    // Un utilisateur Clerk non affecte a une agence n'est pas un acces.
    const result = await resolver(null).resolve({ userId: 'u1' });
    expect(result.status).toBe('NO_MEMBERSHIP');
  });

  it('compose le principal a partir de notre base, pas de Clerk', async () => {
    const result = await resolver({
      agencyId: 'a-rhin',
      networkId: 'n1',
      role: 'DIRECTEUR',
    }).resolve({ userId: 'u1' });

    expect(result.status).toBe('AUTHENTICATED');
    if (result.status !== 'AUTHENTICATED') return;
    expect(result.principal.agencyId).toBe('a-rhin');
    expect(result.principal.role).toBe('DIRECTEUR');
  });

  it('laisse passer les routes publiques', () => {
    expect(isPublicRoute('/opposition')).toBe(true);
    expect(isPublicRoute('/tarifs')).toBe(true);
    expect(isPublicRoute('/radar')).toBe(false);
    expect(isPublicRoute('/admin')).toBe(false);
  });
});

describe('catalogue', () => {
  it('expose trois offres coherentes', () => {
    expect(Object.keys(PLANS)).toEqual(['STARTER', 'PRO', 'RESEAU']);
    expect(PLANS.STARTER.monthlyDrafts).toBe(20);
    expect(PLANS.PRO.monthlyDrafts).toBeNull();
    expect(PLANS.RESEAU.maxTerritories).toBeNull();
  });
});
