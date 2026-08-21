import type { DpeRecord } from '../ports/index.js';

/**
 * Radar Opportunites — regroupement et classement.
 *
 * Probleme constate en conditions reelles (Strasbourg, 20/08/2026) : plusieurs
 * diagnostics portent la MEME adresse BAN — logements distincts d'un meme
 * immeuble, ou diagnostic republie. Sans regroupement, le negociateur voit
 * trois fois la meme porte, et risque de la solliciter trois fois.
 *
 * On regroupe donc a l'ADRESSE, ce qui est coherent avec tout le reste du
 * produit : nous ne detenons aucune information de lot, et un courrier
 * s'adresse a une adresse, pas a un appartement identifie.
 *
 * Le nombre de diagnostics conserves n'est pas jete : plusieurs DPE recents
 * dans un meme immeuble traduisent une activite de copropriete, et c'est une
 * information utile en rendez-vous.
 */
export interface AddressGroup {
  readonly banId: string;
  /** Diagnostic le plus recent a cette adresse : celui qui porte le score. */
  readonly latest: DpeRecord;
  /** Nombre de diagnostics recents constates a la meme adresse. */
  readonly dpeCount: number;
}

export function groupByAddress(records: readonly DpeRecord[]): AddressGroup[] {
  const groups = new Map<string, { latest: DpeRecord; count: number }>();

  for (const record of records) {
    // Faute d'identifiant BAN, le numero de DPE fait office de cle : le bien
    // reste affiche, mais il ne sera de toute facon pas adressable.
    const key = record.embeddedBanId ?? `dpe:${record.dpeNumber}`;
    const existing = groups.get(key);

    if (!existing) {
      groups.set(key, { latest: record, count: 1 });
      continue;
    }

    groups.set(key, {
      latest:
        record.establishedAt.getTime() > existing.latest.establishedAt.getTime()
          ? record
          : existing.latest,
      count: existing.count + 1,
    });
  }

  return [...groups.entries()].map(([banId, group]) => ({
    banId,
    latest: group.latest,
    dpeCount: group.count,
  }));
}

/**
 * Classe des biens deja scores.
 *
 * Un score `null` (confiance insuffisante) est rejete en fin de liste plutot
 * qu'assimile a zero : le bien n'est pas mauvais, il est mal connu, et le
 * negociateur doit pouvoir le consulter s'il descend jusque-la.
 */
export function rankByScore<T extends { readonly score: { readonly score: number | null } }>(
  rows: readonly T[],
): T[] {
  return [...rows].sort((a, b) => (b.score.score ?? -1) - (a.score.score ?? -1));
}
