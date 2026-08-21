/**
 * Couverture territoriale de la base DVF (Demandes de valeurs foncieres).
 *
 * Constat verifie en direct le 20/08/2026 sur files.data.gouv.fr/geo-dvf :
 * les fichiers departementaux 57, 67, 68 et 976 renvoient 404, la ou 01, 13,
 * 75 et 971 repondent 200.
 *
 * Ce n'est pas une panne. L'Alsace-Moselle (Moselle, Bas-Rhin, Haut-Rhin)
 * releve du regime du LIVRE FONCIER issu du droit local, et non de la
 * publicite fonciere qui alimente DVF. Mayotte est hors dispositif pour des
 * raisons cadastrales distinctes.
 *
 * Consequence produit, majeure : sur ces territoires, trois signaux
 * (HOLDING_DURATION, MARKET_VELOCITY, PRICE_MOMENTUM) sont structurellement
 * indisponibles, soit 30 des 100 points du bareme. Le score reste calculable
 * — la renormalisation sur la masse disponible est faite pour cela — mais la
 * confiance plafonne mecaniquement. Voir docs/04-donnees-et-sources.md.
 */
export const DVF_EXCLUDED_DEPARTMENTS = ['57', '67', '68', '976'] as const;

export type DvfExcludedDepartment = (typeof DVF_EXCLUDED_DEPARTMENTS)[number];

/** Extrait le code departement d'un code INSEE communal (gere l'outre-mer). */
export function departmentFromInsee(inseeCode: string): string {
  const normalized = inseeCode.trim();
  if (normalized.startsWith('97') || normalized.startsWith('98')) {
    return normalized.slice(0, 3);
  }
  return normalized.slice(0, 2);
}

export function isDvfCovered(inseeCode: string): boolean {
  const department = departmentFromInsee(inseeCode);
  return !(DVF_EXCLUDED_DEPARTMENTS as readonly string[]).includes(department);
}

/**
 * Plafond de confiance atteignable sans DVF, a geocodage et fraicheur parfaits.
 * Bareme v2 : les signaux DVF pesent 26 points (8 + 10 + 8), la couverture
 * maximale est donc de 74/100, d'ou 0.6*0.74 + 0.2*1 + 0.2*1 = 0.844.
 *
 * Expose pour que l'interface puisse expliquer le plafond au lieu de laisser
 * un directeur d'agence alsacien conclure que l'outil fonctionne mal.
 */
export const MAX_CONFIDENCE_WITHOUT_DVF = 84;

export interface CoverageNotice {
  readonly covered: boolean;
  readonly department: string;
  readonly message: string | null;
}

export function coverageNotice(inseeCode: string): CoverageNotice {
  const department = departmentFromInsee(inseeCode);
  if (isDvfCovered(inseeCode)) {
    return { covered: true, department, message: null };
  }
  const reason =
    department === '976'
      ? 'Mayotte est hors du dispositif DVF.'
      : 'l’Alsace-Moselle releve du livre foncier (droit local) et non de la publicite fonciere.';
  return {
    covered: false,
    department,
    message:
      `Departement ${department} : les donnees de transactions DVF ne sont pas publiees, ${reason} ` +
      `Les signaux de marche et de duree de detention sont indisponibles ; la confiance est plafonnee a ${MAX_CONFIDENCE_WITHOUT_DVF}.`,
  };
}
