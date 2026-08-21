import { describe, expect, it } from 'vitest';
import { SignalBuilder } from '@domain/scoring/services/SignalBuilder.js';
import type { PropertyFacts } from '@domain/scoring/services/SignalBuilder.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const builder = new SignalBuilder();

const idsOf = (facts: PropertyFacts) => builder.build(facts, NOW).map((o) => o.id);

describe('SignalBuilder', () => {
  it('ne produit aucun signal sans aucun fait connu', () => {
    expect(builder.build({}, NOW)).toHaveLength(0);
  });

  it('derive fraicheur et pression a partir du seul DPE', () => {
    const ids = idsOf({ dpe: { dpeClass: 'F', establishedAt: new Date('2026-06-01T00:00:00Z') } });
    expect(ids).toContain('DPE_RECENCY');
    expect(ids).toContain('DPE_CLASS_PRESSURE');
    expect(ids).not.toContain('ENERGY_GAP');
  });

  it('omet la dynamique de marche quand l’echantillon DVF est trop faible', () => {
    const ids = idsOf({
      neighbourhood: {
        salesLast12: 4,
        salesPrevious12: 3,
        pricePerSqmDelta12m: 0.06,
        observedAt: NOW,
      },
    });
    // Trop peu de transactions : le signal est absent, pas a zero.
    expect(ids).not.toContain('MARKET_VELOCITY');
    expect(ids).toContain('PRICE_MOMENTUM');
  });

  it('n’ajoute la baisse de prix que sur une annonce active en baisse', () => {
    expect(
      idsOf({ listing: { active: true, priceDropRatio: 0.08, observedAt: NOW } }),
    ).toContain('LISTING_PRICE_DROP');

    expect(
      idsOf({ listing: { active: false, priceDropRatio: 0.08, observedAt: NOW } }),
    ).not.toContain('LISTING_PRICE_DROP');

    expect(idsOf({ listing: { active: true, observedAt: NOW } })).not.toContain(
      'LISTING_PRICE_DROP',
    );
  });

  it('produit des libelles dates et lisibles par un negociateur', () => {
    const observations = builder.build(
      {
        dpe: { dpeClass: 'E', establishedAt: new Date('2026-06-12T00:00:00Z') },
        lastMutationAt: new Date('2016-03-04T00:00:00Z'),
      },
      NOW,
    );

    const recency = observations.find((o) => o.id === 'DPE_RECENCY');
    expect(recency?.label).toContain('12/06/2026');
    expect(recency?.source).toBe('ADEME');

    const holding = observations.find((o) => o.id === 'HOLDING_DURATION');
    expect(holding?.label).toMatch(/Detention estimee a 10 ans/);
    expect(holding?.source).toBe('DVF');
  });

  it('date chaque observation sur la donnee, pas sur l’instant de calcul', () => {
    const established = new Date('2025-01-15T00:00:00Z');
    const observations = builder.build({ dpe: { dpeClass: 'C', establishedAt: established } }, NOW);
    for (const o of observations) {
      expect(o.observedAt.getTime()).toBe(established.getTime());
    }
  });

  it('compare le bien a la mediane du quartier quand elle est connue', () => {
    const ids = idsOf({
      dpe: { dpeClass: 'G', establishedAt: NOW },
      neighbourhood: {
        medianDpeClass: 'D',
        salesLast12: 40,
        salesPrevious12: 30,
        pricePerSqmDelta12m: 0.04,
        observedAt: NOW,
      },
    });
    expect(ids).toContain('ENERGY_GAP');
    expect(ids).toContain('MARKET_VELOCITY');
  });
});
