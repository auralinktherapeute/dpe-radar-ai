import type { ListingSnapshot, ListingSourcePort, PropertyKey } from '@application/ports/index.js';
import type { Contact, ContactProvenance } from '@domain/crm/Contact.js';
import { normalizePhone, usableContact } from '@domain/crm/Contact.js';
import { parseCsv } from '@infrastructure/dvf/csv.js';

/**
 * Radar Annonces — import depuis le logiciel de pige de l'agence.
 *
 * La quasi-totalite des agences dispose deja d'un outil de pige sous licence
 * (Pige Online, Pericles, MyPige, Directimmo...), qui porte les autorisations
 * de collecte. DPE Radar AI ne collecte donc RIEN lui-meme : il importe ce que
 * l'agence detient legitimement, et le rapproche du Radar par l'identifiant
 * BAN.
 *
 * Cette architecture est licite la ou le scraping ne l'est pas : la source est
 * sous contrat, et la provenance de chaque coordonnee est conservee.
 */
export type PigeVendor = 'PIGE_ONLINE' | 'PERICLES' | 'MYPIGE' | 'DIRECTIMMO' | 'CSV_GENERIQUE';

export interface PigeRow {
  readonly banId: string;
  readonly active: boolean;
  readonly initialPrice: number | null;
  readonly currentPrice: number | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly isPrivateSeller: boolean;
  readonly observedAt: Date;
}

export interface PigeImportResult {
  readonly imported: number;
  readonly rejected: number;
  readonly withPhone: number;
  readonly reasons: readonly string[];
}

/** Colonnes attendues, quel que soit l'editeur. Le mapping est fait a l'import. */
export interface PigeColumnMapping {
  readonly banId: string;
  readonly status: string;
  readonly priceInitial: string;
  readonly priceCurrent: string;
  readonly phone: string;
  readonly email: string;
  readonly sellerType: string;
  readonly observedAt: string;
}

export const DEFAULT_MAPPING: PigeColumnMapping = {
  banId: 'identifiant_ban',
  status: 'statut',
  priceInitial: 'prix_initial',
  priceCurrent: 'prix_actuel',
  phone: 'telephone',
  email: 'email',
  sellerType: 'type_vendeur',
  observedAt: 'date_constat',
};

export class PigeImportSource implements ListingSourcePort {
  private readonly listings = new Map<string, PigeRow>();

  constructor(
    private readonly provenance: Omit<ContactProvenance, 'observedAt'>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  /**
   * Importe un export du logiciel de pige. Les lignes inexploitables sont
   * comptees et motivees plutot qu'ignorees en silence : un import qui perd
   * 30 % des lignes sans le dire est pire qu'un import qui echoue.
   */
  importCsv(csv: string, mapping: PigeColumnMapping = DEFAULT_MAPPING): PigeImportResult {
    let imported = 0;
    let rejected = 0;
    let withPhone = 0;
    const reasons: string[] = [];

    const note = (reason: string) => {
      rejected += 1;
      if (!reasons.includes(reason)) reasons.push(reason);
    };

    for (const record of parseCsv(csv)) {
      const banId = record[mapping.banId]?.trim();
      if (!banId) {
        note('Identifiant BAN absent : la ligne ne peut pas etre rapprochee d’un bien.');
        continue;
      }

      const observedAt = parseDate(record[mapping.observedAt]);
      if (!observedAt) {
        note('Date de constat absente ou invalide.');
        continue;
      }

      const phone = normalizePhone(record[mapping.phone] ?? null);
      if (record[mapping.phone] && !phone) {
        reasons.push('Numero non exploitable, ignore (le reste de la ligne est conserve).');
      }
      if (phone) withPhone += 1;

      const status = (record[mapping.status] ?? '').toLowerCase();
      this.listings.set(banId, {
        banId,
        active: !/retir|vendu|archiv|inactif/.test(status),
        initialPrice: parseAmount(record[mapping.priceInitial]),
        currentPrice: parseAmount(record[mapping.priceCurrent]),
        phone,
        email: record[mapping.email]?.trim() || null,
        isPrivateSeller: /particulier|pap/i.test(record[mapping.sellerType] ?? ''),
        observedAt,
      });
      imported += 1;
    }

    return { imported, rejected, withPhone, reasons };
  }

  async snapshotFor(key: PropertyKey): Promise<ListingSnapshot | null> {
    const row = this.listings.get(key.banId);
    // Absence de ligne = absence d'information, pas absence d'annonce.
    if (!row) return null;

    const drop = priceDropRatio(row.initialPrice, row.currentPrice);
    return {
      active: row.active,
      ...(drop !== null ? { priceDropRatio: drop } : {}),
      observedAt: row.observedAt,
    };
  }

  /** Coordonnees rattachees a un bien, avec leur provenance. */
  contactFor(banId: string): Contact | null {
    const row = this.listings.get(banId);
    if (!row) return null;

    const contact: Contact = {
      banId,
      phone: row.phone,
      email: row.email,
      provenance: {
        ...this.provenance,
        // Un vendeur particulier publie lui-meme ses coordonnees : la
        // provenance le reflete, car le regime applicable en depend.
        kind: row.isPrivateSeller ? 'ANNONCE_PARTICULIER' : this.provenance.kind,
        observedAt: row.observedAt,
      },
    };
    return usableContact(contact, this.now());
  }

  hasPhoneNumber(banId: string): boolean {
    return this.contactFor(banId)?.phone !== null && this.contactFor(banId) !== null;
  }

  get size(): number {
    return this.listings.size;
  }
}

export function priceDropRatio(initial: number | null, current: number | null): number | null {
  if (initial === null || current === null) return null;
  if (initial <= 0 || current <= 0 || current >= initial) return null;
  return (initial - current) / initial;
}

function parseAmount(raw: string | undefined): number | null {
  if (!raw) return null;
  const cleaned = raw.replace(/[^\d.,-]/g, '').replace(',', '.');
  const value = Number(cleaned);
  return Number.isFinite(value) && value > 0 ? value : null;
}

function parseDate(raw: string | undefined): Date | null {
  if (!raw) return null;
  // Les exports francais melangent JJ/MM/AAAA et ISO selon l'editeur.
  const fr = raw.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  const iso = fr ? `${fr[3]}-${fr[2]}-${fr[1]}` : raw.trim();
  const date = new Date(`${iso}T00:00:00Z`);
  return Number.isNaN(date.getTime()) ? null : date;
}
