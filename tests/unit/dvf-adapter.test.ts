import { describe, expect, it } from 'vitest';
import { GeoDvfMarketData, toMutations } from '@infrastructure/dvf/GeoDvfMarketData.js';
import { banJoinKey, dvfJoinKey, parseBanId } from '@infrastructure/dvf/banKey.js';
import { parseCsv } from '@infrastructure/dvf/csv.js';

const HEADER =
  'id_mutation,date_mutation,nature_mutation,valeur_fonciere,adresse_numero,adresse_code_voie,code_commune,type_local,surface_reelle_bati';

function row(id: string, date: string, value: number, surface: number, numero = '51', voie = '9315') {
  return `${id},${date},Vente,${value},${numero},${voie},33063,Appartement,${surface}`;
}

describe('jointure BAN <-> DVF', () => {
  it('decompose un identifiant BAN reel', () => {
    expect(parseBanId('33063_9315_00051')).toEqual({
      inseeCode: '33063',
      voieCode: '9315',
      houseNumber: '51',
    });
  });

  it('produit la meme cle depuis les deux sources — verifie sur donnees reelles', () => {
    // ADEME : identifiant_ban "33063_9315_00051" (51 Cours Victor Hugo)
    // DVF   : code_commune 33063, adresse_code_voie 9315, adresse_numero 51
    expect(banJoinKey('33063_9315_00051')).toBe(dvfJoinKey('33063', '9315', '51'));
  });

  it('rejette les identifiants malformes', () => {
    expect(parseBanId('33063_9315')).toBeNull();
    expect(parseBanId('')).toBeNull();
    expect(dvfJoinKey('33063', '', '51')).toBeNull();
    expect(dvfJoinKey('33063', '9315', '')).toBeNull();
  });
});

describe('parseCsv', () => {
  it('gere les champs entre guillemets et les guillemets echappes', () => {
    const rows = parseCsv('a,b\n"x,1","il dit ""oui"""\n');
    expect(rows).toEqual([{ a: 'x,1', b: 'il dit "oui"' }]);
  });

  it('ignore les lignes vides', () => {
    expect(parseCsv('a,b\n1,2\n\n')).toHaveLength(1);
  });
});

describe('toMutations', () => {
  it('ne retient que le residentiel', () => {
    const csv = [
      HEADER,
      row('m1', '2024-05-02', 200000, 50),
      'm2,2024-05-03,Vente,28000,179,1435,33063,Dépendance,',
      'm3,2024-05-04,Vente,90000,10,1000,33063,Local industriel. commercial ou assimilé,120',
    ].join('\n');

    const mutations = toMutations(csv);
    expect(mutations).toHaveLength(1);
    expect(mutations[0]?.typeLocal).toBe('Appartement');
  });

  it('ecarte une date invalide sans faire tomber le lot', () => {
    const csv = [HEADER, row('m1', 'pas-une-date', 200000, 50), row('m2', '2024-05-02', 200000, 50)].join('\n');
    expect(toMutations(csv)).toHaveLength(1);
  });
});

describe('GeoDvfMarketData', () => {
  function adapter(csv: string, now: Date) {
    return new GeoDvfMarketData({
      baseUrl: 'https://example.test',
      years: [2024],
      now: () => now,
      fetchImpl: (async () => new Response(csv, { status: 200 })) as unknown as typeof fetch,
    });
  }

  it('n’emet aucune requete sur un departement hors couverture DVF', async () => {
    let calls = 0;
    const dvf = new GeoDvfMarketData({
      baseUrl: 'https://example.test',
      years: [2024],
      fetchImpl: (async () => {
        calls += 1;
        return new Response('', { status: 200 });
      }) as unknown as typeof fetch,
    });

    expect(await dvf.statsFor('67482')).toBeNull();
    expect(await dvf.lastMutationAt({ banId: '67482_0100_00001', inseeCode: '67482' })).toBeNull();
    expect(calls).toBe(0);
  });

  it('REGRESSION — ancre les fenetres sur la derniere mutation publiee, pas sur la date du jour', async () => {
    // DVF accuse plusieurs mois de retard de publication. Ancrer sur "maintenant"
    // comparerait un exercice tronque a un exercice complet et ferait lire un
    // effondrement du marche partout (constate sur Bordeaux : -60 % fictifs).
    const csv = [
      HEADER,
      // Exercice le plus recent publie : 3 ventes.
      row('a1', '2025-01-10', 300000, 60),
      row('a2', '2025-03-10', 300000, 60),
      row('a3', '2025-06-10', 300000, 60),
      // Exercice precedent : 2 ventes.
      row('b1', '2024-02-10', 250000, 60),
      row('b2', '2024-04-10', 250000, 60),
    ].join('\n');

    // La date du jour est tres en avance sur les donnees.
    const stats = await adapter(csv, new Date('2026-08-20T00:00:00Z')).statsFor('33063');

    expect(stats).not.toBeNull();
    // Ancre = 2025-06-10. Fenetre recente = 3 ventes, precedente = 2.
    expect(stats?.salesLast12).toBe(3);
    expect(stats?.salesPrevious12).toBe(2);
    // La latence est rendue visible par la date d'observation, qui fera
    // baisser la confiance du score au lieu de fausser le signal.
    expect(stats?.observedAt.toISOString().slice(0, 10)).toBe('2025-06-10');
  });

  it('compte les mutations distinctes, pas les lignes de lots', async () => {
    const csv = [
      HEADER,
      row('m1', '2025-01-10', 300000, 60),
      row('m1', '2025-01-10', 300000, 20), // second lot de la MEME vente
      row('m2', '2025-02-10', 300000, 60),
    ].join('\n');

    const stats = await adapter(csv, new Date('2025-06-01T00:00:00Z')).statsFor('33063');
    expect(stats?.salesLast12).toBe(2);
  });

  it('retrouve la derniere mutation a l’adresse exacte', async () => {
    const csv = [
      HEADER,
      row('m1', '2016-03-04', 200000, 60, '51', '9315'),
      row('m2', '2021-07-09', 260000, 60, '51', '9315'),
      row('m3', '2023-01-05', 260000, 60, '52', '9315'), // voisin : ne compte pas
    ].join('\n');

    const dvf = adapter(csv, new Date('2025-01-01T00:00:00Z'));
    const date = await dvf.lastMutationAt({ banId: '33063_9315_00051', inseeCode: '33063' });
    expect(date?.toISOString().slice(0, 10)).toBe('2021-07-09');
  });

  it('renvoie null quand l’adresse n’a jamais mute — cas nominal', async () => {
    const csv = [HEADER, row('m1', '2021-07-09', 260000, 60, '51', '9315')].join('\n');
    const dvf = adapter(csv, new Date('2025-01-01T00:00:00Z'));
    expect(await dvf.lastMutationAt({ banId: '33063_9315_00099', inseeCode: '33063' })).toBeNull();
  });

  it('ecarte les prix au m2 aberrants du calcul de mediane', async () => {
    const csv = [
      HEADER,
      row('m1', '2025-01-10', 1, 60), // cession a l'euro symbolique
      row('m2', '2025-02-10', 300000, 60),
      row('m3', '2024-02-10', 300000, 60),
    ].join('\n');

    const stats = await adapter(csv, new Date('2025-06-01T00:00:00Z')).statsFor('33063');
    // La vente a 1 euro est exclue : le prix median ne s'effondre pas.
    expect(stats?.pricePerSqmDelta12m).toBe(0);
  });
});
