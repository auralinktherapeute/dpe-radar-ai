import type { SignalObservation } from '../signals/SignalId.js';
import { SIGNAL_LABELS, isSignalId } from '../signals/SignalId.js';
import { SCALE_VERSION, SIGNAL_WEIGHTS, TOTAL_WEIGHT } from '../signals/weights.js';
import type { GeoPrecisionLevel } from '../value-objects/GeoPrecision.js';
import { geoPrecisionWeight, isMailable } from '../value-objects/GeoPrecision.js';
import type {
  ComparabilityGroup,
  OpportunityScore,
  ScoreReason,
} from '../entities/OpportunityScore.js';
import { CONFIDENCE_MIN_FOR_EXACT_SCORE, bandFor } from '../entities/OpportunityScore.js';
import { clamp } from '../signals/normalizers.js';

export interface ScoringInput {
  /** Uniquement les signaux DISPONIBLES. Un signal absent n'est pas un signal a 0. */
  readonly observations: readonly SignalObservation[];
  readonly geoPrecision: GeoPrecisionLevel;
  readonly computedAt: Date;
}

/** Au-dela, une donnee est consideree comme perimee pour le calcul de fraicheur. */
const FRESHNESS_HORIZON_DAYS = 540;
const MAX_REASONS = 5;

/**
 * Ponderation de la confiance.
 *
 * La couverture pese davantage que la fraicheur et le geocodage : c'est elle
 * qui dit combien on SAIT du bien. Avec le bareme v2, un signal unique vaut
 * jusqu'a 45 points ; sans cette ponderation, un bien connu par son seul DPE
 * atteignait 71 de confiance, soit presque le seuil « fiable » sur une seule
 * observation. Corrige apres le backtest du 20/08/2026.
 */
const COVERAGE_WEIGHT = 0.6;
const FRESHNESS_WEIGHT = 0.2;
const GEO_WEIGHT = 0.2;

/**
 * Moteur de scoring d'intention de vente.
 *
 * Pur, deterministe, sans I/O : c'est ce qui permet de le backtester sur
 * donnees historiques et de le rejouer a l'identique pour justifier un score
 * a posteriori (exigence d'explicabilite du profilage).
 */
export class IntentScoringService {
  score(input: ScoringInput): OpportunityScore {
    const observations = dedupeKeepMostRecent(input.observations);

    let weightedSum = 0;
    let availableMass = 0;

    for (const obs of observations) {
      const weight = SIGNAL_WEIGHTS[obs.id];
      weightedSum += clamp(obs.value) * weight;
      availableMass += weight;
    }

    const coverage = availableMass / TOTAL_WEIGHT;
    const geoWeight = geoPrecisionWeight(input.geoPrecision);

    // Aucun signal exploitable : on le dit, on n'invente pas.
    if (availableMass === 0) {
      return {
        score: null,
        band: 'INDETERMINE',
        range: { min: 0, max: 100 },
        confidence: Math.round(100 * GEO_WEIGHT * geoWeight),
        coverage: 0,
        reasons: [],
        mailable: isMailable(input.geoPrecision),
        comparabilityGroup: 'NO_MARKET_DATA',
        scaleVersion: SCALE_VERSION,
        computedAt: input.computedAt,
      };
    }

    // Renormalisation sur la masse disponible, pas sur 100 : un bien connu
    // seulement par son DPE n'est pas "mauvais", il est "mal connu".
    // L'incertitude est portee par la confiance, jamais par le score.
    const rawScore = (100 * weightedSum) / availableMass;
    const roundedScore = Math.round(rawScore);

    const freshness = this.freshness(observations, input.computedAt);
    const confidence = Math.round(
      100 * (COVERAGE_WEIGHT * coverage + FRESHNESS_WEIGHT * freshness + GEO_WEIGHT * geoWeight),
    );

    const reasons = this.buildReasons(observations, availableMass);
    const margin = Math.round((1 - confidence / 100) * 25);
    const range = {
      min: Math.max(0, roundedScore - margin),
      max: Math.min(100, roundedScore + margin),
    };

    const trustworthy = confidence >= CONFIDENCE_MIN_FOR_EXACT_SCORE;

    return {
      score: trustworthy ? roundedScore : null,
      band: trustworthy ? bandFor(roundedScore) : 'INDETERMINE',
      range,
      confidence,
      coverage,
      reasons,
      mailable: isMailable(input.geoPrecision),
      comparabilityGroup: comparabilityGroupFor(observations),
      scaleVersion: SCALE_VERSION,
      computedAt: input.computedAt,
    };
  }

  private freshness(
    observations: readonly SignalObservation[],
    computedAt: Date,
  ): number {
    const ages = observations.map((o) => {
      const days = (computedAt.getTime() - o.observedAt.getTime()) / 86_400_000;
      return Math.max(0, days);
    });
    const oldest = Math.max(...ages);
    return clamp(1 - oldest / FRESHNESS_HORIZON_DAYS);
  }

  private buildReasons(
    observations: readonly SignalObservation[],
    availableMass: number,
  ): ScoreReason[] {
    return observations
      .map((obs) => ({
        signalId: obs.id,
        label: obs.label || SIGNAL_LABELS[obs.id],
        contribution:
          Math.round(((clamp(obs.value) * SIGNAL_WEIGHTS[obs.id]) / availableMass) * 1000) /
          10,
        source: obs.source,
        observedAt: obs.observedAt,
      }))
      .filter((r) => r.contribution > 0)
      .sort((a, b) => b.contribution - a.contribution)
      .slice(0, MAX_REASONS);
  }
}

/**
 * Un score calcule sans aucun signal de marche appartient a un autre regime
 * que celui d'un bien pleinement documente. Les melanger dans un meme
 * classement induit en erreur.
 */
function comparabilityGroupFor(
  observations: readonly SignalObservation[],
): ComparabilityGroup {
  return observations.some((o) => o.source === 'DVF') ? 'FULL' : 'NO_MARKET_DATA';
}

/**
 * Deux sources peuvent fournir le meme signal (ex. un DPE republie).
 * On garde l'observation la plus recente, et on ignore tout identifiant
 * hors liste blanche — defense en profondeur cote domaine.
 */
function dedupeKeepMostRecent(
  observations: readonly SignalObservation[],
): SignalObservation[] {
  const bySignal = new Map<string, SignalObservation>();
  for (const obs of observations) {
    if (!isSignalId(obs.id)) continue;
    const existing = bySignal.get(obs.id);
    if (!existing || obs.observedAt.getTime() > existing.observedAt.getTime()) {
      bySignal.set(obs.id, obs);
    }
  }
  return [...bySignal.values()];
}
