import { describe, expect, it } from 'vitest';
import {
  MAX_CONFIDENCE_WITHOUT_DVF,
  coverageNotice,
  departmentFromInsee,
  isDvfCovered,
} from '@domain/scoring/value-objects/DvfCoverage.js';
import { IntentScoringService } from '@domain/scoring/services/IntentScoringService.js';
import type { SignalObservation } from '@domain/scoring/signals/SignalId.js';

describe('departmentFromInsee', () => {
  it('gere metropole et outre-mer', () => {
    expect(departmentFromInsee('67482')).toBe('67');
    expect(departmentFromInsee('75056')).toBe('75');
    expect(departmentFromInsee('97601')).toBe('976');
  });
});

describe('couverture DVF', () => {
  it('exclut l’Alsace-Moselle et Mayotte — verifie sur l’API le 20/08/2026', () => {
    expect(isDvfCovered('67482')).toBe(false); // Strasbourg
    expect(isDvfCovered('68066')).toBe(false); // Colmar
    expect(isDvfCovered('57463')).toBe(false); // Metz
    expect(isDvfCovered('97601')).toBe(false); // Mamoudzou
  });

  it('couvre le reste du territoire', () => {
    expect(isDvfCovered('75056')).toBe(true);
    expect(isDvfCovered('13055')).toBe(true);
    expect(isDvfCovered('97105')).toBe(true); // Guadeloupe : couverte
  });

  it('explique la cause au lieu de laisser croire a un bug', () => {
    const alsace = coverageNotice('67482');
    expect(alsace.covered).toBe(false);
    expect(alsace.message).toContain('livre foncier');
    expect(alsace.message).toContain(String(MAX_CONFIDENCE_WITHOUT_DVF));

    expect(coverageNotice('75056').message).toBeNull();
  });
});

describe('degradation du score hors couverture DVF', () => {
  const service = new IntentScoringService();
  const NOW = new Date('2026-08-20T09:00:00Z');

  const obs = (id: SignalObservation['id'], value: number): SignalObservation => ({
    id,
    value,
    observedAt: NOW,
    source: 'ADEME',
    label: id,
  });

  it('reste calculable sans DVF, mais sous le plafond de confiance annonce', () => {
    // Alsace : seuls les signaux ADEME et pige sont disponibles.
    const sansDvf = service.score({
      observations: [
        obs('DPE_RECENCY', 1),
        obs('DPE_CLASS_PRESSURE', 1),
        obs('ENERGY_GAP', 1),
        { ...obs('NO_ACTIVE_LISTING', 1), source: 'PIGE' },
      ],
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });

    expect(sansDvf.score).not.toBeNull();
    expect(sansDvf.confidence).toBeLessThanOrEqual(MAX_CONFIDENCE_WITHOUT_DVF);
    expect(sansDvf.confidence).toBeGreaterThanOrEqual(40);
  });

  it('atteint exactement le plafond dans les meilleures conditions possibles', () => {
    const parfait = service.score({
      observations: (
        ['DPE_RECENCY', 'DPE_CLASS_PRESSURE', 'ENERGY_GAP', 'NO_ACTIVE_LISTING', 'LISTING_PRICE_DROP'] as const
      ).map((id) => obs(id, 1)),
      geoPrecision: 'HOUSENUMBER',
      computedAt: NOW,
    });
    // Bareme v2 : les signaux hors DVF pesent 74 points sur 100.
    expect(parfait.confidence).toBe(MAX_CONFIDENCE_WITHOUT_DVF);
  });
});
