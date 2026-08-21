/**
 * Classe energetique d'un DPE (arrete du 31 mars 2021).
 * Le rang est utilise pour mesurer un ecart au quartier ; il n'a pas
 * de sens metier en dehors de cette comparaison ordinale.
 */
export const DPE_CLASSES = ['A', 'B', 'C', 'D', 'E', 'F', 'G'] as const;

export type DpeClass = (typeof DPE_CLASSES)[number];

export function isDpeClass(value: string): value is DpeClass {
  return (DPE_CLASSES as readonly string[]).includes(value);
}

/** A = 0 ... G = 6. */
export function dpeRank(dpeClass: DpeClass): number {
  return DPE_CLASSES.indexOf(dpeClass);
}

/**
 * Un logement classe F ou G est une "passoire thermique" au sens du
 * Code de la construction. G est interdit a la location depuis 2025,
 * F l'est a compter de 2028.
 */
export function isPassoireThermique(dpeClass: DpeClass): boolean {
  return dpeClass === 'F' || dpeClass === 'G';
}
