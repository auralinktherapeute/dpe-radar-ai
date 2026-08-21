import type { SignalId } from './SignalId.js';
import { SIGNAL_IDS } from './SignalId.js';

/**
 * Bareme v2 — recale sur le backtest du 20/08/2026 (Bordeaux, 3 557 maisons,
 * T0 = 30/06/2023, fenetre d'observation de 12 mois, 528 mises en vente
 * observees, taux de base 14,9 %).
 *
 * Trois corrections imposees par la mesure, contre les priors initiaux :
 *
 *  1. DPE_RECENCY porte l'essentiel du pouvoir discriminant (1,82x a 0-3 mois
 *     contre 0,33x au-dela de 18 mois). Son poids passe de 30 a 45.
 *  2. DPE_CLASS_PRESSURE ne discrimine quasiment pas : A-B 1,13x, C 0,94x,
 *     D 0,96x, E 1,11x, F 1,15x, G 0,69x. La these « passoire thermique =
 *     vendeur » n'est PAS confirmee, et G ressort meme sous le taux de base.
 *     Le poids tombe de 15 a 5, conserve au titre du calendrier reglementaire
 *     (interdiction de location F en 2028), pas de la preuve empirique.
 *  3. HOLDING_DURATION voit son poids reduit de 12 a 8 : geo-dvf ne publie
 *     que 2021-2025, si bien qu'une detention de plus de ~4 ans n'est pas
 *     observable. Le signal ne sait, en pratique, que detecter un achat
 *     recent — mesure a 0,63x, donc defavorable, ce qui valide le plancher.
 *
 * Le numero de version est stocke avec CHAQUE score calcule : un score
 * n'est interpretable que si l'on sait avec quel bareme il a ete produit.
 * Toute modification des poids impose d'incrementer SCALE_VERSION.
 */
export const SCALE_VERSION = 'v2.0.0-calibre';

export const SIGNAL_WEIGHTS: Record<SignalId, number> = {
  DPE_RECENCY: 45,
  NO_ACTIVE_LISTING: 12,
  MARKET_VELOCITY: 10,
  HOLDING_DURATION: 8,
  PRICE_MOMENTUM: 8,
  LISTING_PRICE_DROP: 8,
  DPE_CLASS_PRESSURE: 5,
  ENERGY_GAP: 4,
};

export const TOTAL_WEIGHT = SIGNAL_IDS.reduce((sum, id) => sum + SIGNAL_WEIGHTS[id], 0);

/**
 * Invariant structurel : la somme des poids vaut 100. Le respecter permet de
 * lire un poids comme "points de score maximum apportes par ce signal".
 */
export function assertWeightsAreValid(): void {
  if (TOTAL_WEIGHT !== 100) {
    throw new Error(
      `Bareme invalide : la somme des poids vaut ${TOTAL_WEIGHT}, attendu 100.`,
    );
  }
}
