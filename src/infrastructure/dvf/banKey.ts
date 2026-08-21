/**
 * Jointure ADEME <-> DVF a l'adresse.
 *
 * Constat verifie le 20/08/2026 en comparant les deux sources :
 *   ADEME `identifiant_ban` = "33063_9315_00051"
 *   DVF   code_commune=33063, adresse_code_voie=9315, adresse_numero=51
 *
 * L'identifiant BAN se decompose en {code INSEE}_{code voie}_{numero sur 5}.
 * DVF porte les memes composants en colonnes separees. La jointure est donc
 * EXACTE, sans appariement flou de libelles de voie — ce qui evite la
 * principale source de faux positifs de ce type d'outil.
 */
export interface BanParts {
  readonly inseeCode: string;
  readonly voieCode: string;
  readonly houseNumber: string;
}

export function parseBanId(banId: string): BanParts | null {
  const parts = banId.split('_');
  if (parts.length !== 3) return null;
  const [inseeCode, voieCode, rawNumber] = parts;
  if (!inseeCode || !voieCode || !rawNumber) return null;
  return { inseeCode, voieCode, houseNumber: stripLeadingZeros(rawNumber) };
}

/** Reconstruit la cle de jointure a partir d'une ligne DVF. */
export function dvfJoinKey(
  codeCommune: string,
  codeVoie: string,
  numero: string,
): string | null {
  const voie = codeVoie.trim();
  const number = stripLeadingZeros(numero.trim());
  if (!codeCommune.trim() || !voie || !number) return null;
  return `${codeCommune.trim()}_${voie}_${number}`;
}

export function banJoinKey(banId: string): string | null {
  const parts = parseBanId(banId);
  if (!parts) return null;
  return `${parts.inseeCode}_${parts.voieCode}_${parts.houseNumber}`;
}

function stripLeadingZeros(value: string): string {
  const stripped = value.replace(/^0+/, '');
  return stripped.length > 0 ? stripped : value.length > 0 ? '0' : '';
}
