import { describe, expect, it } from 'vitest';
import { IntentScoringService } from '@domain/scoring/services/IntentScoringService.js';
import type { SignalObservation } from '@domain/scoring/signals/SignalId.js';
import { SIGNAL_WEIGHTS, TOTAL_WEIGHT, assertWeightsAreValid } from '@domain/scoring/signals/weights.js';
import { CONFIDENCE_HIGH } from '@domain/scoring/entities/OpportunityScore.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const service = new IntentScoringService();

function obs(
  id: SignalObservation['id'],
  value: number,
  daysAgo = 30,
  source: SignalObservation['source'] = 'ADEME',
): SignalObservation {
  return {
    id,
    value,
    observedAt: new Date(NOW.getTime() - daysAgo * 86_400_000),
    source,
    label: id,
  };
}

describe('bareme', () => {
  it('somme a 100 — un poids se lit en points de score', () => {
    expect(TOTAL_WEIGHT).toBe(100);
    expect(() => assertWeightsAreValid()).not.toThrow();
  });
});

describe('IntentScoringService — renormalisation', () => {
  it('renormalise sur la masse disponible et non sur 100', () => {
    // Un seul signal, parfait. Le bien n'est pas "mauvais" parce qu'on ignore
    // le reste : il est tres favorable sur ce qu'on sait, et mal connu.
    const result = service.score({
      observations: [obs('DPE_RECENCY', 1)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(result.score).toBe(100);
    // ... mais la couverture ne represente que 45 % du bareme.
    expect(result.coverage).toBeCloseTo(SIGNAL_WEIGHTS.DPE_RECENCY / 100, 5);
    // L'incertitude est portee par la confiance, jamais par le score.
    // Un signal unique ne doit jamais atteindre le seuil « fiable ».
    expect(result.confidence).toBeLessThan(CONFIDENCE_HIGH);
  });

  it('n’ecrase pas le score d’un bien partiellement connu', () => {
    const partiel = service.score({
      observations: [obs('DPE_RECENCY', 1)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    const complet = service.score({
      observations: [
        obs('DPE_RECENCY', 1),
        obs('DPE_CLASS_PRESSURE', 1),
        obs('NO_ACTIVE_LISTING', 1, 1, 'PIGE'),
        obs('HOLDING_DURATION', 1, 60, 'DVF'),
      ],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(partiel.score).toBe(complet.score);
    expect(partiel.confidence).toBeLessThan(complet.confidence);
  });
});

describe('IntentScoringService — confiance', () => {
  it('refuse un score chiffre sous le seuil de confiance', () => {
    const result = service.score({
      observations: [obs('ENERGY_GAP', 0.8, 700)],
      geoPrecision: 'MUNICIPALITY',
      computedAt: NOW,
    });

    expect(result.confidence).toBeLessThan(40);
    expect(result.score).toBeNull();
    expect(result.band).toBe('INDETERMINE');
    // La fourchette reste exploitable meme sans chiffre exact.
    expect(result.range.max).toBeGreaterThan(result.range.min);
  });

  it('renvoie un resultat honnete quand aucun signal n’est disponible', () => {
    const result = service.score({
      observations: [],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(result.score).toBeNull();
    expect(result.band).toBe('INDETERMINE');
    expect(result.coverage).toBe(0);
    expect(result.range).toEqual({ min: 0, max: 100 });
    expect(result.reasons).toHaveLength(0);
  });

  it('penalise la confiance quand la donnee la plus ancienne vieillit', () => {
    const frais = service.score({
      observations: [obs('DPE_RECENCY', 0.8, 10)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    const vieux = service.score({
      observations: [obs('DPE_RECENCY', 0.8, 500)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(vieux.confidence).toBeLessThan(frais.confidence);
    expect(vieux.score).toBe(frais.score);
  });

  it('la fourchette se resserre quand la confiance monte', () => {
    const large = service.score({
      observations: [obs('DPE_RECENCY', 0.6, 400)],
      geoPrecision: 'STREET',
      computedAt: NOW,
    });
    const serree = service.score({
      observations: [
        obs('DPE_RECENCY', 0.6, 5),
        obs('DPE_CLASS_PRESSURE', 0.6, 5),
        obs('NO_ACTIVE_LISTING', 0.6, 1, 'PIGE'),
        obs('HOLDING_DURATION', 0.6, 20, 'DVF'),
        obs('MARKET_VELOCITY', 0.6, 20, 'DVF'),
        obs('PRICE_MOMENTUM', 0.6, 20, 'DVF'),
      ],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    const largeur = (r: { range: { min: number; max: number } }) => r.range.max - r.range.min;
    expect(largeur(serree)).toBeLessThan(largeur(large));
  });
});

describe('IntentScoringService — explicabilite', () => {
  const complet = service.score({
    observations: [
      obs('DPE_RECENCY', 1, 60),
      obs('NO_ACTIVE_LISTING', 1, 1, 'PIGE'),
      obs('HOLDING_DURATION', 0.95, 120, 'DVF'),
      obs('MARKET_VELOCITY', 0.7, 120, 'DVF'),
      obs('DPE_CLASS_PRESSURE', 0.45, 60),
      obs('PRICE_MOMENTUM', 0.4, 120, 'DVF'),
      obs('ENERGY_GAP', 0.33, 60),
    ],
    geoPrecision: 'HOUSENUMBER',
    computedAt: NOW,
  });

  it('limite a cinq raisons, triees par contribution decroissante', () => {
    expect(complet.reasons.length).toBeLessThanOrEqual(5);
    const contributions = complet.reasons.map((r) => r.contribution);
    expect([...contributions].sort((a, b) => b - a)).toEqual(contributions);
  });

  it('date et source chaque raison — condition de credibilite en rendez-vous', () => {
    for (const reason of complet.reasons) {
      expect(reason.observedAt).toBeInstanceOf(Date);
      expect(['ADEME', 'DVF', 'PIGE']).toContain(reason.source);
      expect(reason.contribution).toBeGreaterThan(0);
    }
  });

  it('n’affiche pas de raison a contribution nulle', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 1), obs('PRICE_MOMENTUM', 0, 30, 'DVF')],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    expect(result.reasons.map((r) => r.signalId)).not.toContain('PRICE_MOMENTUM');
  });

  it('les contributions reconstituent le score', () => {
    const total = complet.reasons.reduce((s, r) => s + r.contribution, 0);
    // Les raisons sont plafonnees a 5 : le total minore le score, sans le depasser.
    expect(total).toBeLessThanOrEqual((complet.score ?? 0) + 0.5);
  });
});

describe('IntentScoringService — robustesse des entrees', () => {
  it('conserve l’observation la plus recente en cas de doublon', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 0.05, 900), obs('DPE_RECENCY', 1, 10)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    expect(result.score).toBe(100);
    expect(result.reasons).toHaveLength(1);
  });

  it('ignore un identifiant de signal hors liste blanche', () => {
    const rogue = {
      id: 'REVENU_MEDIAN_QUARTIER',
      value: 1,
      observedAt: NOW,
      source: 'DVF',
      label: 'signal interdit',
    } as unknown as SignalObservation;

    const result = service.score({
      observations: [obs('DPE_RECENCY', 0.6), rogue],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(result.reasons.map((r) => r.signalId)).not.toContain('REVENU_MEDIAN_QUARTIER');
    expect(result.coverage).toBeCloseTo(SIGNAL_WEIGHTS.DPE_RECENCY / 100, 5);
  });

  it('borne une valeur aberrante au lieu de la propager', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 42)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    expect(result.score).toBe(100);
  });
});

describe('IntentScoringService — ciblage postal', () => {
  it('marque non adressable un bien geocode a la commune', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 1)],
      geoPrecision: 'MUNICIPALITY',
      computedAt: NOW,
    });
    expect(result.mailable).toBe(false);
  });

  it('autorise l’adressage a partir du numero de rue', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 1)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    expect(result.mailable).toBe(true);
  });
});

describe('IntentScoringService — tracabilite', () => {
  it('estampille chaque score avec la version du bareme', () => {
    const result = service.score({
      observations: [obs('DPE_RECENCY', 1)],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    expect(result.scaleVersion).toMatch(/^v\d+\.\d+\.\d+/);
    expect(result.computedAt).toEqual(NOW);
  });
});

describe('IntentScoringService — comparabilite entre territoires', () => {
  const NOW2 = new Date('2026-08-20T09:00:00Z');
  const svc = new IntentScoringService();

  const make = (id: SignalObservation['id'], source: SignalObservation['source']) => ({
    id,
    value: 1,
    observedAt: NOW2,
    source,
    label: id,
  });

  it('marque comme non comparable un score calcule sans donnee de marche', () => {
    const alsace = svc.score({
      observations: [make('DPE_RECENCY', 'ADEME'), make('DPE_CLASS_PRESSURE', 'ADEME')],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW2,
    });
    expect(alsace.comparabilityGroup).toBe('NO_MARKET_DATA');
  });

  it('marque comme comparable un score appuye sur DVF', () => {
    const bordeaux = svc.score({
      observations: [make('DPE_RECENCY', 'ADEME'), make('MARKET_VELOCITY', 'DVF')],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW2,
    });
    expect(bordeaux.comparabilityGroup).toBe('FULL');
  });

  it('illustre l’inflation des scores hors DVF — d’ou l’interdiction de melanger', () => {
    // Memes signaux ADEME au maximum, mais l'un des deux beneficie de DVF
    // avec des signaux de marche neutres.
    const sansMarche = svc.score({
      observations: [make('DPE_RECENCY', 'ADEME'), make('DPE_CLASS_PRESSURE', 'ADEME')],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW2,
    });
    const avecMarche = svc.score({
      observations: [
        make('DPE_RECENCY', 'ADEME'),
        make('DPE_CLASS_PRESSURE', 'ADEME'),
        { ...make('MARKET_VELOCITY', 'DVF'), value: 0 },
        { ...make('PRICE_MOMENTUM', 'DVF'), value: 0 },
      ],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW2,
    });

    expect(sansMarche.score).toBeGreaterThan(avecMarche.score as number);
    expect(sansMarche.comparabilityGroup).not.toBe(avecMarche.comparabilityGroup);
  });
});
