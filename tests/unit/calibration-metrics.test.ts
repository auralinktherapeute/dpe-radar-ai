import { describe, expect, it } from 'vitest';
import {
  AUC_THRESHOLD,
  LIFT_THRESHOLD_GO,
  LIFT_THRESHOLD_STOP,
  MIN_OBSERVATIONS,
  auc,
  brier,
  deciles,
  evaluate,
  rankWithTies,
  verdictFor,
} from '@domain/calibration/Metrics.js';
import type { Observation } from '@domain/calibration/Metrics.js';

const obs = (score: number, label: 0 | 1): Observation => ({ score, label });

describe('rangs avec ex aequo', () => {
  it('attribue des rangs moyens aux valeurs egales', () => {
    // Sans cela, l'AUC serait biaisee par les paliers du bareme.
    expect(rankWithTies([10, 20, 20, 30])).toEqual([1, 2.5, 2.5, 4]);
  });

  it('gere une liste sans egalite', () => {
    expect(rankWithTies([5, 1, 3])).toEqual([3, 1, 2]);
  });
});

describe('AUC', () => {
  it('vaut 1 sur une separation parfaite', () => {
    expect(auc([obs(90, 1), obs(80, 1), obs(20, 0), obs(10, 0)])).toBe(1);
  });

  it('vaut 0,5 quand le score n’apporte aucune information', () => {
    expect(auc([obs(50, 1), obs(50, 0), obs(50, 1), obs(50, 0)])).toBe(0.5);
  });

  it('descend sous 0,5 quand le modele se trompe systematiquement', () => {
    expect(auc([obs(10, 1), obs(20, 1), obs(80, 0), obs(90, 0)])).toBe(0);
  });

  it('renvoie null sans classe positive ou negative', () => {
    expect(auc([obs(50, 1), obs(60, 1)])).toBeNull();
    expect(auc([])).toBeNull();
  });
});

describe('score de Brier', () => {
  it('recompense une prediction proche de la realite', () => {
    expect(brier([obs(100, 1), obs(0, 0)])).toBe(0);
  });

  it('penalise une prediction assuree et fausse', () => {
    expect(brier([obs(100, 0)])).toBe(1);
  });

  it('renvoie 0 sur un echantillon vide', () => {
    expect(brier([])).toBe(0);
  });
});

describe('deciles et lift', () => {
  it('calcule le lift du decile superieur par rapport au taux de base', () => {
    // 100 biens, 10 positifs, tous concentres dans le meilleur decile.
    const observations: Observation[] = [
      ...Array.from({ length: 10 }, (_, i) => obs(100 - i, 1 as const)),
      ...Array.from({ length: 90 }, (_, i) => obs(50 - i * 0.1, 0 as const)),
    ];
    const rows = deciles(observations);
    expect(rows).toHaveLength(10);
    expect(rows[0]?.rate).toBe(1);
    // Taux de base 10 %, decile a 100 % : lift de 10.
    expect(rows[0]?.lift).toBeCloseTo(10, 5);
  });

  it('renvoie une liste vide sans observation', () => {
    expect(deciles([])).toEqual([]);
  });
});

describe('verdict', () => {
  it('exige un echantillon minimal avant de se prononcer', () => {
    expect(verdictFor(MIN_OBSERVATIONS - 1, 5, 0.9)).toBe('ECHANTILLON_INSUFFISANT');
    expect(verdictFor(1000, null, 0.9)).toBe('ECHANTILLON_INSUFFISANT');
  });

  it('declare inexploitable un lift sous le plancher', () => {
    expect(verdictFor(1000, LIFT_THRESHOLD_STOP - 0.1, 0.9)).toBe('INEXPLOITABLE');
  });

  it('declare commercialisable un modele qui franchit les deux seuils', () => {
    expect(verdictFor(1000, LIFT_THRESHOLD_GO, AUC_THRESHOLD)).toBe('COMMERCIALISABLE');
  });

  it('exige AUC ET lift — un seul des deux ne suffit pas', () => {
    expect(verdictFor(1000, LIFT_THRESHOLD_GO, AUC_THRESHOLD - 0.05)).toBe('A_RETRAVAILLER');
    expect(verdictFor(1000, LIFT_THRESHOLD_GO - 0.3, 0.95)).toBe('A_RETRAVAILLER');
  });
});

describe('rapport complet', () => {
  it('assemble taux de base, AUC, lift et verdict', () => {
    const observations: Observation[] = [
      ...Array.from({ length: 40 }, (_, i) => obs(95 - i * 0.1, (i < 20 ? 1 : 0) as 0 | 1)),
      ...Array.from({ length: 260 }, (_, i) => obs(40 - i * 0.1, 0 as const)),
    ];
    const report = evaluate(observations);

    expect(report.total).toBe(300);
    expect(report.positives).toBe(20);
    expect(report.baseRate).toBeCloseTo(20 / 300, 5);
    expect(report.topDecileLift).toBeGreaterThan(LIFT_THRESHOLD_GO);
    expect(report.verdict).toBe('COMMERCIALISABLE');
  });

  it('ne se prononce pas sur un echantillon trop faible', () => {
    expect(evaluate([obs(90, 1), obs(10, 0)]).verdict).toBe('ECHANTILLON_INSUFFISANT');
  });
});
