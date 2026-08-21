/**
 * Liste blanche des signaux autorises dans le score.
 *
 * CONFORMITE : cette liste est un garde-fou, pas une simple enumeration.
 * Tout ajout doit passer par la revue decrite dans docs/01-conformite.
 * Sont explicitement exclus : tout signal socio-demographique, de sante,
 * de situation familiale ou de revenu (cf. docs/03-modele-de-scoring, s.8).
 */
export const SIGNAL_IDS = [
  'DPE_RECENCY',
  'DPE_CLASS_PRESSURE',
  'NO_ACTIVE_LISTING',
  'HOLDING_DURATION',
  'MARKET_VELOCITY',
  'PRICE_MOMENTUM',
  'LISTING_PRICE_DROP',
  'ENERGY_GAP',
] as const;

export type SignalId = (typeof SIGNAL_IDS)[number];

export type SignalSource = 'ADEME' | 'DVF' | 'PIGE';

/** Une observation d'un signal pour un bien donne, a une date donnee. */
export interface SignalObservation {
  readonly id: SignalId;
  /** Valeur normalisee dans [0,1]. */
  readonly value: number;
  /** Date de la donnee sous-jacente (pas la date de calcul). */
  readonly observedAt: Date;
  readonly source: SignalSource;
  /** Libelle metier de la valeur brute, affiche tel quel au negociateur. */
  readonly label: string;
}

export const SIGNAL_LABELS: Record<SignalId, string> = {
  DPE_RECENCY: 'Fraicheur du diagnostic energetique',
  DPE_CLASS_PRESSURE: 'Pression reglementaire liee a la classe',
  NO_ACTIVE_LISTING: 'Absence d’annonce active',
  HOLDING_DURATION: 'Duree de detention estimee',
  MARKET_VELOCITY: 'Dynamique des ventes du quartier',
  PRICE_MOMENTUM: 'Evolution du prix au m2',
  LISTING_PRICE_DROP: 'Baisse de prix constatee',
  ENERGY_GAP: 'Ecart au DPE median du quartier',
};

export function isSignalId(value: string): value is SignalId {
  return (SIGNAL_IDS as readonly string[]).includes(value);
}
