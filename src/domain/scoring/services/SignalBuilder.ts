import type { DpeClass } from '../value-objects/DpeClass.js';
import type { SignalObservation } from '../signals/SignalId.js';
import {
  classPressure,
  dpeRecency,
  energyGap,
  holdingDuration,
  listingPriceDrop,
  marketVelocity,
  monthsBetween,
  noActiveListing,
  priceMomentum,
  yearsBetween,
} from '../signals/normalizers.js';

/**
 * Faits bruts connus sur un bien, tels que les adaptateurs les rapportent.
 * Chaque bloc est optionnel : l'absence de donnee est un cas nominal, pas
 * une erreur. C'est le point ou l'on refuse d'imputer des valeurs par defaut.
 */
export interface PropertyFacts {
  readonly dpe?: {
    readonly dpeClass: DpeClass;
    readonly establishedAt: Date;
  };
  readonly neighbourhood?: {
    readonly medianDpeClass?: DpeClass;
    readonly salesLast12: number;
    readonly salesPrevious12: number;
    /** Variation relative du prix/m2 sur 12 mois (0.08 = +8 %). */
    readonly pricePerSqmDelta12m: number;
    readonly observedAt: Date;
  };
  /** Derniere mutation connue a cette adresse (DVF). */
  readonly lastMutationAt?: Date;
  readonly listing?: {
    readonly active: boolean;
    /** Baisse relative depuis le prix initial (0.07 = -7 %). */
    readonly priceDropRatio?: number;
    readonly observedAt: Date;
  };
}

function frenchDate(date: Date): string {
  return date.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

/**
 * Traduit des faits bruts en observations normalisees.
 *
 * Pur et sans I/O : c'est ce qui permet de rejouer a l'identique la
 * construction des signaux d'un score passe, et de backtester sur des
 * donnees historiques sans fuite temporelle.
 */
export class SignalBuilder {
  build(facts: PropertyFacts, asOf: Date): SignalObservation[] {
    const observations: SignalObservation[] = [];

    if (facts.dpe) {
      const ageMonths = monthsBetween(facts.dpe.establishedAt, asOf);
      observations.push({
        id: 'DPE_RECENCY',
        value: dpeRecency(ageMonths),
        observedAt: facts.dpe.establishedAt,
        source: 'ADEME',
        label: `DPE realise le ${frenchDate(facts.dpe.establishedAt)} (il y a ${Math.round(ageMonths)} mois)`,
      });

      observations.push({
        id: 'DPE_CLASS_PRESSURE',
        value: classPressure(facts.dpe.dpeClass),
        observedAt: facts.dpe.establishedAt,
        source: 'ADEME',
        label: `Classe energetique ${facts.dpe.dpeClass}`,
      });

      const median = facts.neighbourhood?.medianDpeClass;
      if (median) {
        observations.push({
          id: 'ENERGY_GAP',
          value: energyGap(facts.dpe.dpeClass, median),
          observedAt: facts.neighbourhood!.observedAt,
          source: 'ADEME',
          label: `Classe ${facts.dpe.dpeClass} face a une mediane de quartier en ${median}`,
        });
      }
    }

    if (facts.lastMutationAt) {
      const years = yearsBetween(facts.lastMutationAt, asOf);
      observations.push({
        id: 'HOLDING_DURATION',
        value: holdingDuration(years),
        observedAt: facts.lastMutationAt,
        source: 'DVF',
        label: `Detention estimee a ${years.toFixed(0)} ans (derniere mutation ${frenchDate(facts.lastMutationAt)})`,
      });
    }

    if (facts.neighbourhood) {
      const velocity = marketVelocity(
        facts.neighbourhood.salesLast12,
        facts.neighbourhood.salesPrevious12,
      );
      // `null` = echantillon trop faible. On omet le signal plutot que de
      // fabriquer une valeur : la confiance baissera d'elle-meme.
      if (velocity !== null) {
        const evolution =
          facts.neighbourhood.salesLast12 / facts.neighbourhood.salesPrevious12 - 1;
        observations.push({
          id: 'MARKET_VELOCITY',
          value: velocity,
          observedAt: facts.neighbourhood.observedAt,
          source: 'DVF',
          label: `Ventes du quartier ${formatPercent(evolution)} sur 12 mois (${facts.neighbourhood.salesLast12} transactions)`,
        });
      }

      observations.push({
        id: 'PRICE_MOMENTUM',
        value: priceMomentum(facts.neighbourhood.pricePerSqmDelta12m),
        observedAt: facts.neighbourhood.observedAt,
        source: 'DVF',
        label: `Prix au m2 ${formatPercent(facts.neighbourhood.pricePerSqmDelta12m)} sur 12 mois`,
      });
    }

    if (facts.listing) {
      observations.push({
        id: 'NO_ACTIVE_LISTING',
        value: noActiveListing(facts.listing.active),
        observedAt: facts.listing.observedAt,
        source: 'PIGE',
        label: facts.listing.active
          ? 'Annonce active detectee sur les portails'
          : 'Aucune annonce active detectee',
      });

      const drop = facts.listing.priceDropRatio;
      if (facts.listing.active && drop !== undefined && drop > 0) {
        observations.push({
          id: 'LISTING_PRICE_DROP',
          value: listingPriceDrop(drop),
          observedAt: facts.listing.observedAt,
          source: 'PIGE',
          label: `Baisse de prix de ${(drop * 100).toFixed(0)} % depuis la mise en ligne`,
        });
      }
    }

    return observations;
  }
}

function formatPercent(ratio: number): string {
  const sign = ratio >= 0 ? '+' : '';
  return `${sign}${(ratio * 100).toFixed(0)} %`;
}
