import type { SignalId, SignalSource } from '../signals/SignalId.js';

/** Bande d'affichage : ce que le negociateur lit avant le chiffre. */
export type ScoreBand = 'INDETERMINE' | 'FAIBLE' | 'MODERE' | 'ELEVE' | 'PRIORITAIRE';

/**
 * Une raison affichee au negociateur. La date de la donnee est obligatoire :
 * citer une information sans savoir de quand elle date decredibilise en
 * rendez-vous (docs/03-modele-de-scoring, s.6).
 */
export interface ScoreReason {
  readonly signalId: SignalId;
  readonly label: string;
  /** Points de score apportes par ce signal, arrondis au dixieme. */
  readonly contribution: number;
  readonly source: SignalSource;
  readonly observedAt: Date;
}

/**
 * Regime de donnees sous lequel le score a ete calcule.
 *
 * Deux scores de regimes differents NE SONT PAS COMPARABLES : sans DVF, la
 * renormalisation concentre le bareme sur moins de signaux et releve
 * mecaniquement les scores. Constate sur donnees reelles le 20/08/2026 —
 * un bien strasbourgeois ressort a 86 la ou son equivalent bordelais est a 79,
 * sans que le premier soit une meilleure opportunite.
 *
 * L'interface doit classer a l'interieur d'un groupe, jamais entre groupes.
 */
export type ComparabilityGroup = 'FULL' | 'NO_MARKET_DATA';

export interface ScoreRange {
  readonly min: number;
  readonly max: number;
}

export interface OpportunityScore {
  /**
   * Score 0-100, ou `null` lorsque la confiance est insuffisante.
   * `null` est un resultat legitime, pas une erreur : afficher un chiffre
   * qu'on ne sait pas justifier coute plus cher que ne rien afficher.
   */
  readonly score: number | null;
  readonly band: ScoreBand;
  /** Fourchette d'incertitude, toujours renseignee. */
  readonly range: ScoreRange;
  readonly confidence: number;
  /** Part du bareme effectivement couverte par des donnees, dans [0,1]. */
  readonly coverage: number;
  readonly reasons: readonly ScoreReason[];
  /** Le bien peut-il recevoir un courrier adresse ? (precision du geocodage) */
  readonly mailable: boolean;
  /** Voir ComparabilityGroup : interdit tout classement inter-territoires. */
  readonly comparabilityGroup: ComparabilityGroup;
  readonly scaleVersion: string;
  readonly computedAt: Date;
}

export const CONFIDENCE_MIN_FOR_EXACT_SCORE = 40;
export const CONFIDENCE_HIGH = 70;

export function bandFor(score: number): ScoreBand {
  if (score >= 80) return 'PRIORITAIRE';
  if (score >= 60) return 'ELEVE';
  if (score >= 35) return 'MODERE';
  return 'FAIBLE';
}
