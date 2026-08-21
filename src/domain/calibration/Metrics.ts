/**
 * Metriques de calibration du modele.
 *
 * Toutes sont pures et testables. Elles servent a repondre a UNE question :
 * les biens du haut de classement se mettent-ils reellement en vente plus
 * souvent que la moyenne du secteur ? Tant qu'on ne sait pas y repondre, le
 * produit ne vaut pas son abonnement.
 */

export interface Observation {
  /** Score attribue a T0, avec les seules donnees disponibles a T0. */
  readonly score: number;
  /** 1 si une mise en vente a ete observee dans la fenetre, 0 sinon. */
  readonly label: 0 | 1;
}

export interface DecileRow {
  readonly decile: number;
  readonly count: number;
  readonly positives: number;
  readonly rate: number;
  /** Rapport entre le taux du decile et le taux de base. */
  readonly lift: number;
}

export interface CalibrationReport {
  readonly total: number;
  readonly positives: number;
  readonly baseRate: number;
  readonly auc: number | null;
  readonly brier: number;
  readonly topDecileLift: number | null;
  readonly deciles: readonly DecileRow[];
  readonly verdict: Verdict;
}

export type Verdict = 'COMMERCIALISABLE' | 'A_RETRAVAILLER' | 'INEXPLOITABLE' | 'ECHANTILLON_INSUFFISANT';

/** Seuils declares dans docs/03-modele-de-scoring, s.7. */
export const LIFT_THRESHOLD_GO = 2.5;
export const LIFT_THRESHOLD_STOP = 2.0;
export const AUC_THRESHOLD = 0.68;
export const MIN_OBSERVATIONS = 200;

/**
 * AUC par la statistique de Mann-Whitney, avec gestion des ex aequo.
 * Implementee a la main : la formule est courte, et une dependance externe
 * sur une metrique qui decide de la commercialisation serait deplacee.
 */
export function auc(observations: readonly Observation[]): number | null {
  const positives = observations.filter((o) => o.label === 1);
  const negatives = observations.filter((o) => o.label === 0);
  if (positives.length === 0 || negatives.length === 0) return null;

  const ranks = rankWithTies(observations.map((o) => o.score));
  let sumRanksPositive = 0;
  observations.forEach((o, index) => {
    if (o.label === 1) sumRanksPositive += ranks[index] as number;
  });

  const n1 = positives.length;
  const n0 = negatives.length;
  const u = sumRanksPositive - (n1 * (n1 + 1)) / 2;
  return u / (n1 * n0);
}

/** Rangs moyens en cas d'egalite — sinon l'AUC est biaisee par les paliers. */
export function rankWithTies(values: readonly number[]): number[] {
  const indexed = values.map((value, index) => ({ value, index }));
  indexed.sort((a, b) => a.value - b.value);

  const ranks = new Array<number>(values.length).fill(0);
  let i = 0;
  while (i < indexed.length) {
    let j = i;
    while (j + 1 < indexed.length && indexed[j + 1]!.value === indexed[i]!.value) j += 1;
    const averageRank = (i + j + 2) / 2;
    for (let k = i; k <= j; k += 1) ranks[indexed[k]!.index] = averageRank;
    i = j + 1;
  }
  return ranks;
}

/**
 * Score de Brier. Le score 0-100 n'est PAS une probabilite : on le ramene
 * sur [0,1] uniquement pour comparer le modele a une prediction constante
 * egale au taux de base.
 */
export function brier(observations: readonly Observation[]): number {
  if (observations.length === 0) return 0;
  const sum = observations.reduce(
    (acc, o) => acc + (o.score / 100 - o.label) ** 2,
    0,
  );
  return sum / observations.length;
}

export function deciles(observations: readonly Observation[]): DecileRow[] {
  if (observations.length === 0) return [];
  const baseRate = rate(observations);
  const sorted = [...observations].sort((a, b) => b.score - a.score);
  const size = Math.ceil(sorted.length / 10);

  const rows: DecileRow[] = [];
  for (let d = 0; d < 10; d += 1) {
    const slice = sorted.slice(d * size, (d + 1) * size);
    if (slice.length === 0) break;
    const positives = slice.filter((o) => o.label === 1).length;
    const sliceRate = positives / slice.length;
    rows.push({
      decile: d + 1,
      count: slice.length,
      positives,
      rate: sliceRate,
      lift: baseRate > 0 ? sliceRate / baseRate : 0,
    });
  }
  return rows;
}

export function rate(observations: readonly Observation[]): number {
  if (observations.length === 0) return 0;
  return observations.filter((o) => o.label === 1).length / observations.length;
}

export function evaluate(observations: readonly Observation[]): CalibrationReport {
  const baseRate = rate(observations);
  const rows = deciles(observations);
  const topLift = rows[0]?.lift ?? null;
  const areaUnderCurve = auc(observations);

  return {
    total: observations.length,
    positives: observations.filter((o) => o.label === 1).length,
    baseRate,
    auc: areaUnderCurve,
    brier: brier(observations),
    topDecileLift: topLift,
    deciles: rows,
    verdict: verdictFor(observations.length, topLift, areaUnderCurve),
  };
}

/**
 * Le verdict est calcule, pas negocie. La regle a ete ecrite avant de
 * connaitre le resultat, precisement pour qu'elle engage quand elle
 * deviendra couteuse.
 */
export function verdictFor(
  total: number,
  topDecileLift: number | null,
  areaUnderCurve: number | null,
): Verdict {
  if (total < MIN_OBSERVATIONS || topDecileLift === null) return 'ECHANTILLON_INSUFFISANT';
  if (topDecileLift < LIFT_THRESHOLD_STOP) return 'INEXPLOITABLE';
  if (topDecileLift >= LIFT_THRESHOLD_GO && (areaUnderCurve ?? 0) >= AUC_THRESHOLD) {
    return 'COMMERCIALISABLE';
  }
  return 'A_RETRAVAILLER';
}
