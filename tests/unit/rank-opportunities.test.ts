import { describe, expect, it } from 'vitest';
import { groupByAddress, rankByScore } from '@application/use-cases/RankOpportunities.js';
import { dpeRecord } from '../fixtures/fakes.js';

describe('regroupement a l’adresse', () => {
  it('REGRESSION — un immeuble n’occupe qu’une ligne du Radar', () => {
    // Constate en conditions reelles a Strasbourg : plusieurs logements d'un
    // meme immeuble partagent l'identifiant BAN. Sans regroupement, le
    // negociateur voit trois fois la meme porte.
    const groups = groupByAddress([
      dpeRecord({ dpeNumber: 'A', embeddedBanId: '67482_3379_00003' }),
      dpeRecord({ dpeNumber: 'B', embeddedBanId: '67482_3379_00003' }),
      dpeRecord({ dpeNumber: 'C', embeddedBanId: '67482_3379_00003' }),
      dpeRecord({ dpeNumber: 'D', embeddedBanId: '67482_9999_00010' }),
    ]);

    expect(groups).toHaveLength(2);
    expect(groups.find((g) => g.banId === '67482_3379_00003')?.dpeCount).toBe(3);
  });

  it('conserve le diagnostic le plus recent de l’adresse', () => {
    const groups = groupByAddress([
      dpeRecord({
        dpeNumber: 'ancien',
        embeddedBanId: '67482_3379_00003',
        establishedAt: new Date('2025-02-01T00:00:00Z'),
      }),
      dpeRecord({
        dpeNumber: 'recent',
        embeddedBanId: '67482_3379_00003',
        establishedAt: new Date('2026-08-10T00:00:00Z'),
        dpeClass: 'F',
      }),
    ]);

    expect(groups[0]?.latest.dpeNumber).toBe('recent');
    expect(groups[0]?.latest.dpeClass).toBe('F');
  });

  it('n’ecrase pas deux biens sans identifiant BAN', () => {
    const groups = groupByAddress([
      dpeRecord({ dpeNumber: 'X', embeddedBanId: null }),
      dpeRecord({ dpeNumber: 'Y', embeddedBanId: null }),
    ]);
    expect(groups).toHaveLength(2);
  });

  it('renvoie une liste vide sans diagnostic', () => {
    expect(groupByAddress([])).toEqual([]);
  });
});

describe('classement', () => {
  const row = (score: number | null) => ({ score: { score } });

  it('trie du score le plus eleve au plus faible', () => {
    const ranked = rankByScore([row(52), row(88), row(71)]);
    expect(ranked.map((r) => r.score.score)).toEqual([88, 71, 52]);
  });

  it('rejette en fin de liste un bien sans score fiable, sans l’assimiler a zero', () => {
    const ranked = rankByScore([row(null), row(12), row(90)]);
    expect(ranked.map((r) => r.score.score)).toEqual([90, 12, null]);
  });

  it('ne modifie pas la liste d’origine', () => {
    const rows = [row(10), row(90)];
    rankByScore(rows);
    expect(rows[0]?.score.score).toBe(10);
  });
});
