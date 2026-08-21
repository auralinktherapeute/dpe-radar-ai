import { describe, expect, it } from 'vitest';
import {
  clamp,
  classPressure,
  dpeRecency,
  energyGap,
  holdingDuration,
  listingPriceDrop,
  marketVelocity,
  monthsBetween,
  noActiveListing,
  priceMomentum,
  HOLDING_PEAK_YEARS,
  MIN_SALES_SAMPLE,
} from '@domain/scoring/signals/normalizers.js';

describe('clamp', () => {
  it('borne les valeurs et neutralise NaN', () => {
    expect(clamp(1.7)).toBe(1);
    expect(clamp(-0.3)).toBe(0);
    expect(clamp(0.42)).toBe(0.42);
    expect(clamp(Number.NaN)).toBe(0);
  });
});

describe('dpeRecency', () => {
  it('decroit par paliers cales sur la mesure du backtest', () => {
    // Lifts mesures le 20/08/2026 : 1,82x / 1,78x / 0,77x / 0,47x / 0,33x.
    expect(dpeRecency(1)).toBe(1);
    expect(dpeRecency(4)).toBe(0.98);
    expect(dpeRecency(9)).toBe(0.42);
    expect(dpeRecency(15)).toBe(0.26);
    expect(dpeRecency(24)).toBe(0.18);
  });

  it('marque le decrochage mesure entre 6 et 12 mois', () => {
    // La v1 lissait a 0,6 ; la mesure montre un effondrement.
    expect(dpeRecency(6) - dpeRecency(7)).toBeGreaterThan(0.5);
  });

  it('est monotone decroissante — promesse faite au negociateur', () => {
    let previous = Number.POSITIVE_INFINITY;
    for (let age = 0; age <= 36; age += 1) {
      const value = dpeRecency(age);
      expect(value).toBeLessThanOrEqual(previous);
      previous = value;
    }
  });

  it('traite une date future comme un diagnostic tout frais', () => {
    expect(dpeRecency(-2)).toBe(1);
  });
});

describe('holdingDuration', () => {
  it('culmine autour de 9 ans de detention', () => {
    const peak = holdingDuration(HOLDING_PEAK_YEARS);
    expect(peak).toBeCloseTo(1, 5);
    expect(holdingDuration(4)).toBeLessThan(peak);
    expect(holdingDuration(16)).toBeLessThan(peak);
  });

  it('plancher sous 2 ans, valide par la mesure (0,63x, sous le taux de base)', () => {
    expect(holdingDuration(0.5)).toBe(0.3);
    expect(holdingDuration(1.9)).toBe(0.3);
    expect(holdingDuration(-3)).toBe(0.3);
  });

  it('monte entre 2 et 7 ans, ou la mesure donne 1,44x', () => {
    expect(holdingDuration(2)).toBeCloseTo(0.5, 5);
    expect(holdingDuration(6.9)).toBeGreaterThan(0.9);
  });

  it('ne descend jamais sous le plancher au-dela du pic, faute d’observabilite', () => {
    // geo-dvf ne publie que 2021-2025 : au-dela de ~4 ans, la duree n'est pas
    // observable. On garde un prior prudent plutot qu'une chute artificielle.
    expect(holdingDuration(30)).toBeGreaterThanOrEqual(0.3);
  });
});

describe('classPressure', () => {
  it('marque le decrochage E -> F du calendrier locatif', () => {
    expect(classPressure('G')).toBe(1);
    expect(classPressure('F') - classPressure('E')).toBeGreaterThan(0.3);
    expect(classPressure('A')).toBeLessThan(0.1);
  });
});

describe('marketVelocity', () => {
  it('declare le signal indisponible sous l’echantillon minimal', () => {
    expect(marketVelocity(10, MIN_SALES_SAMPLE - 1)).toBeNull();
    expect(marketVelocity(3, 0)).toBeNull();
  });

  it('sature a +30 % de transactions', () => {
    expect(marketVelocity(130, 100)).toBe(1);
    expect(marketVelocity(100, 100)).toBeCloseTo(0.25, 5);
    expect(marketVelocity(80, 100)).toBe(0);
  });

  it('null n’est pas 0 — indisponible n’est pas defavorable', () => {
    expect(marketVelocity(4, 4)).not.toBe(0);
  });
});

describe('priceMomentum', () => {
  it('annule le signal a -5 % et le sature a +10 %', () => {
    expect(priceMomentum(-0.05)).toBe(0);
    expect(priceMomentum(0.1)).toBe(1);
    expect(priceMomentum(0.025)).toBeCloseTo(0.5, 5);
  });
});

describe('listingPriceDrop', () => {
  it('ignore les hausses et sature a -10 %', () => {
    expect(listingPriceDrop(0)).toBe(0);
    expect(listingPriceDrop(-0.04)).toBe(0);
    expect(listingPriceDrop(0.1)).toBe(1);
    expect(listingPriceDrop(0.05)).toBeCloseTo(0.5, 5);
  });
});

describe('energyGap', () => {
  it('mesure un ecart ordinal sature a 3 crans', () => {
    expect(energyGap('D', 'D')).toBe(0);
    expect(energyGap('G', 'D')).toBe(1);
    expect(energyGap('A', 'G')).toBe(1);
    expect(energyGap('E', 'D')).toBeCloseTo(1 / 3, 5);
  });
});

describe('noActiveListing', () => {
  it('vaut 1 quand aucune annonce n’est active', () => {
    expect(noActiveListing(false)).toBe(1);
    expect(noActiveListing(true)).toBe(0);
  });
});

describe('monthsBetween', () => {
  it('mesure un ecart en mois moyens', () => {
    const from = new Date('2026-01-01T00:00:00Z');
    const to = new Date('2026-07-01T00:00:00Z');
    expect(monthsBetween(from, to)).toBeCloseTo(5.95, 1);
  });
});
