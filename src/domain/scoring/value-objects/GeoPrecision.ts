/**
 * Precision du geocodage, issue du score et du type de resultat de la
 * Base Adresse Nationale. Elle conditionne deux choses :
 *  - la confiance du score,
 *  - le droit d'inclure le bien dans un export de courrier adresse
 *    (on n'envoie pas un courrier a une rue).
 */
export type GeoPrecisionLevel = 'HOUSENUMBER' | 'STREET' | 'MUNICIPALITY' | 'UNKNOWN';

const WEIGHTS: Record<GeoPrecisionLevel, number> = {
  HOUSENUMBER: 1.0,
  STREET: 0.6,
  MUNICIPALITY: 0.2,
  UNKNOWN: 0.0,
};

export function geoPrecisionWeight(level: GeoPrecisionLevel): number {
  return WEIGHTS[level];
}

/** Seuil en dessous duquel un bien ne peut pas etre cible par courrier adresse. */
export const MIN_GEO_FOR_MAILING = 0.5;

export function isMailable(level: GeoPrecisionLevel): boolean {
  return geoPrecisionWeight(level) >= MIN_GEO_FOR_MAILING;
}

/** Traduit la reponse de l'API BAN (type + score) en niveau de precision. */
export function fromBanResult(type: string, score: number): GeoPrecisionLevel {
  if (score < 0.4) return 'UNKNOWN';
  switch (type) {
    case 'housenumber':
      return 'HOUSENUMBER';
    case 'street':
      return 'STREET';
    case 'municipality':
    case 'locality':
      return 'MUNICIPALITY';
    default:
      return 'UNKNOWN';
  }
}
