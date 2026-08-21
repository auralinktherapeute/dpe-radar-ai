/**
 * Coordonnees d'un prospect.
 *
 * Point cardinal : une coordonnee n'entre JAMAIS dans le systeme depuis les
 * donnees publiques (ADEME, DVF, BAN n'en contiennent pas). Elle provient
 * exclusivement du logiciel de pige sous licence de l'agence, ou d'une
 * saisie de l'agence elle-meme.
 *
 * Chaque coordonnee porte donc sa PROVENANCE. Ce n'est pas de la
 * bureaucratie : en cas de controle, c'est la piece qui montre d'ou vient le
 * numero et sous quelle licence il a ete obtenu. Sans provenance, pas de
 * coordonnee.
 */
export type ContactProvenanceKind =
  /** Logiciel de pige sous licence de l'agence. */
  | 'PIGE_LICENCE'
  /** Annonce de particulier, coordonnees publiees par lui-meme. */
  | 'ANNONCE_PARTICULIER'
  /** Saisie par l'agence (contact entrant, relation existante). */
  | 'SAISIE_AGENCE';

export interface ContactProvenance {
  readonly kind: ContactProvenanceKind;
  /** Editeur du logiciel de pige, ou source de la saisie. */
  readonly sourceName: string;
  /** Reference du contrat de licence de l'agence. */
  readonly licenceRef: string | null;
  /** Date a laquelle la coordonnee a ete constatee a la source. */
  readonly observedAt: Date;
}

export interface Contact {
  readonly banId: string;
  readonly phone: string | null;
  readonly email: string | null;
  readonly provenance: ContactProvenance;
}

/** Au-dela, une coordonnee de pige est trop ancienne pour etre composee. */
export const CONTACT_STALE_AFTER_DAYS = 90;

export function isContactStale(contact: Contact, now: Date): boolean {
  const days = (now.getTime() - contact.provenance.observedAt.getTime()) / 86_400_000;
  return days > CONTACT_STALE_AFTER_DAYS;
}

/**
 * Normalise un numero francais au format E.164.
 * Renvoie `null` sur tout ce qui n'est pas un numero exploitable : mieux vaut
 * pas de numero qu'un numero errone compose par un negociateur.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^\d+]/g, '');
  if (digits.startsWith('+33')) {
    const rest = digits.slice(3).replace(/^0/, '');
    return rest.length === 9 ? `+33${rest}` : null;
  }
  if (digits.startsWith('0033')) return normalizePhone(`+33${digits.slice(4)}`);
  if (/^0\d{9}$/.test(digits)) return `+33${digits.slice(1)}`;
  return null;
}

/**
 * Les numeros surtaxes et les numeros courts ne sont pas des lignes de
 * particuliers : les composer signale une erreur d'import.
 */
export function isCallableFrenchNumber(e164: string): boolean {
  if (!/^\+33[1-9]\d{8}$/.test(e164)) return false;
  const prefix = e164.slice(3, 4);
  // 0800-0899 (surtaxes) sont portes par le prefixe 8.
  return prefix !== '8';
}

export function usableContact(contact: Contact, now: Date): Contact | null {
  if (isContactStale(contact, now)) return null;
  const phone = contact.phone && isCallableFrenchNumber(contact.phone) ? contact.phone : null;
  if (!phone && !contact.email) return null;
  return { ...contact, phone };
}
