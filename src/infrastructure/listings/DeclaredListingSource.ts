import type { ListingSnapshot, ListingSourcePort, PropertyKey } from '@application/ports/index.js';

/**
 * Radar Annonces — implementation declarative.
 *
 * Le scraping des portails est ecarte : la CNIL vise explicitement le
 * contournement des conditions d'utilisation des sites sources, et les CGU des
 * portails l'interdisent. Tant qu'un accord de flux n'est pas signe, la seule
 * voie licite est la DECLARATION : l'agence saisit (ou importe depuis son
 * logiciel de pige sous licence) les annonces qu'elle constate.
 *
 * C'est degrade, et c'est dit comme tel dans l'interface : `observedAt` porte
 * la date de la derniere verification humaine, ce qui fait baisser la confiance
 * du score a mesure que la declaration vieillit. Une donnee declaree il y a six
 * mois ne doit pas peser autant qu'une verification du matin.
 */
export interface DeclaredListing {
  readonly banId: string;
  readonly active: boolean;
  readonly initialPrice: number | null;
  readonly currentPrice: number | null;
  readonly declaredBy: string;
  readonly observedAt: Date;
}

export interface DeclaredListingStore {
  findByBanId(banId: string): Promise<DeclaredListing | null>;
}

/** Au-dela, une declaration est trop vieille pour etre affirmee. */
export const DECLARATION_STALE_AFTER_DAYS = 45;

export class DeclaredListingSource implements ListingSourcePort {
  constructor(
    private readonly store: DeclaredListingStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async snapshotFor(key: PropertyKey): Promise<ListingSnapshot | null> {
    const declared = await this.store.findByBanId(key.banId);

    // Aucune declaration : on ne conclut RIEN. Renvoyer "aucune annonce
    // active" serait une affirmation que personne n'a verifiee — c'est
    // exactement le raccourci qui ferait proposer un bien deja en vente.
    if (!declared) return null;

    if (isStale(declared.observedAt, this.now())) return null;

    return toSnapshot(declared);
  }
}

export function isStale(observedAt: Date, now: Date): boolean {
  const days = (now.getTime() - observedAt.getTime()) / 86_400_000;
  return days > DECLARATION_STALE_AFTER_DAYS;
}

export function toSnapshot(declared: DeclaredListing): ListingSnapshot {
  const drop = priceDropRatio(declared.initialPrice, declared.currentPrice);
  return {
    active: declared.active,
    ...(drop !== null ? { priceDropRatio: drop } : {}),
    observedAt: declared.observedAt,
  };
}

/** Baisse relative depuis le prix initial. Une hausse renvoie `null`. */
export function priceDropRatio(
  initial: number | null,
  current: number | null,
): number | null {
  if (initial === null || current === null) return null;
  if (initial <= 0 || current <= 0) return null;
  if (current >= initial) return null;
  return (initial - current) / initial;
}
