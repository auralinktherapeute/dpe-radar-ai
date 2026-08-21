import type { DpeClass } from '../value-objects/DpeClass.js';
import { dpeRank } from '../value-objects/DpeClass.js';

/**
 * Fonctions de normalisation : chaque signal brut -> valeur dans [0,1].
 *
 * Toutes sont pures et monotones par rapport a leur entree metier. La
 * monotonie n'est pas un detail mathematique : c'est ce qui permet de dire
 * a un negociateur "plus le DPE est recent, plus le score monte" sans mentir.
 *
 * Convention : un retour `null` signifie SIGNAL INDISPONIBLE. Il ne doit
 * jamais etre confondu avec la valeur 0 (signal disponible et defavorable).
 * Cette distinction porte toute la difference entre le score et la confiance.
 */

export function clamp(value: number, min = 0, max = 1): number {
  if (Number.isNaN(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export function monthsBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime();
  return ms / (1000 * 60 * 60 * 24 * 30.436875);
}

export function yearsBetween(from: Date, to: Date): number {
  return monthsBetween(from, to) / 12;
}

/**
 * Fraicheur du DPE, par paliers.
 * Le metier raisonne en trimestres ("le DPE du printemps"), pas en jours :
 * une courbe continue donnerait une fausse impression de precision.
 */
export function dpeRecency(ageInMonths: number): number {
  if (ageInMonths < 0) return 1;
  if (ageInMonths <= 3) return 1.0;
  if (ageInMonths <= 6) return 0.98;
  // Decrochage mesure entre 6 et 12 mois : 1,78x -> 0,77x. La v1 lissait a
  // 0,6, ce qui surestimait nettement les diagnostics de plus de six mois.
  if (ageInMonths <= 12) return 0.42;
  if (ageInMonths <= 18) return 0.26;
  return 0.18;
}

/** Pression reglementaire : decrochage marque entre E et F (calendrier locatif). */
const CLASS_PRESSURE: Record<DpeClass, number> = {
  G: 1.0,
  F: 0.85,
  E: 0.45,
  D: 0.2,
  C: 0.1,
  B: 0.05,
  A: 0.05,
};

export function classPressure(dpeClass: DpeClass): number {
  return CLASS_PRESSURE[dpeClass];
}

/**
 * Duree de detention : cloche centree sur 9 ans.
 * Plancher sous 2 ans — entre frais de notaire et fiscalite de la plus-value,
 * une revente immediate reste rare.
 */
export const HOLDING_PEAK_YEARS = 9;
const HOLDING_SIGMA = 4.5;

export function holdingDuration(years: number): number {
  if (years < 0) return 0.3;
  // Mesure : un achat de moins de deux ans ressort a 0,63x, sous le taux de
  // base. Le plancher de la v1 est valide, mais 0,05 etait trop severe.
  if (years < 2) return 0.3;
  // Mesure : 1,44x entre 2 et 7 ans. Montee lineaire jusqu'au pic.
  if (years < 7) return 0.5 + ((years - 2) / 5) * 0.5;
  // AU-DELA DE ~4 ANS, LA DUREE N'EST PAS OBSERVABLE avec geo-dvf, qui ne
  // publie que 2021-2025. La cloche reste un prior, non confirme par la
  // mesure : c'est pourquoi le poids du signal a ete reduit a 8.
  const exponent = -((years - HOLDING_PEAK_YEARS) ** 2) / (2 * HOLDING_SIGMA ** 2);
  return clamp(Math.max(Math.exp(exponent), 0.3));
}

/**
 * Dynamique des ventes du quartier.
 * En dessous de MIN_SALES_SAMPLE transactions sur la periode de reference, le
 * ratio est du bruit : on prefere declarer le signal indisponible plutot que
 * de fabriquer un score sur trois ventes.
 */
export const MIN_SALES_SAMPLE = 5;

export function marketVelocity(
  salesLast12: number,
  salesPrevious12: number,
): number | null {
  if (salesPrevious12 < MIN_SALES_SAMPLE) return null;
  const ratio = salesLast12 / salesPrevious12;
  return clamp((ratio - 0.9) / 0.4);
}

/** Momentum du prix/m2 : -5 % annule le signal, +10 % le sature. */
export function priceMomentum(deltaRatio: number): number {
  return clamp((deltaRatio + 0.05) / 0.15);
}

/** Baisse de prix sur une annonce active : -10 % sature le signal. */
export function listingPriceDrop(dropRatio: number): number {
  if (dropRatio <= 0) return 0;
  return clamp(dropRatio / 0.1);
}

/** Ecart ordinal au DPE median du quartier, sature a 3 crans. */
export function energyGap(propertyClass: DpeClass, medianClass: DpeClass): number {
  return clamp(Math.abs(dpeRank(propertyClass) - dpeRank(medianClass)) / 3);
}

/** Absence d'annonce active : signal binaire. */
export function noActiveListing(hasActiveListing: boolean): number {
  return hasActiveListing ? 0 : 1;
}
