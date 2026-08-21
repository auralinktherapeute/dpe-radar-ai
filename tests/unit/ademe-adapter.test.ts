import { describe, expect, it } from 'vitest';
import {
  AdemeDpeSource,
  AdemeUnavailableError,
  embeddedGeo,
  hasHouseNumber,
  toDpeRecord,
  toIsoDay,
} from '@infrastructure/ademe/AdemeDpeSource.js';

/** Ligne reelle du jeu `dpe03existant`, relevee sur l'API le 20/08/2026. */
const REAL_LINE = {
  adresse_ban: '1 Rue du Lejat 86240 Fontaine-le-Comte',
  identifiant_ban: '86100_1860_00001',
  code_insee_ban: '86100',
  statut_geocodage: "adresse géocodée ban à l'adresse",
  score_ban: 0.95,
  type_batiment: 'maison',
  numero_dpe: '2686E2104566J',
  date_etablissement_dpe: '2026-08-10',
  date_reception_dpe: '2026-08-10',
  surface_habitable_logement: 187.8,
  etiquette_dpe: 'C',
};

describe('toDpeRecord', () => {
  it('convertit une ligne reelle de l’ADEME', () => {
    const record = toDpeRecord(REAL_LINE);
    expect(record).not.toBeNull();
    expect(record?.dpeNumber).toBe('2686E2104566J');
    expect(record?.dpeClass).toBe('C');
    expect(record?.buildingType).toBe('maison');
    expect(record?.surfaceM2).toBe(187.8);
    expect(record?.establishedAt.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it.each([
    ['numero_dpe', { numero_dpe: undefined }],
    ['etiquette_dpe', { etiquette_dpe: undefined }],
    ['adresse_ban', { adresse_ban: undefined }],
    ['code_insee_ban', { code_insee_ban: undefined }],
  ])('rejette une ligne sans %s plutot que de faire tomber le batch', (_field, patch) => {
    expect(toDpeRecord({ ...REAL_LINE, ...patch })).toBeNull();
  });

  it('rejette une etiquette hors A-G', () => {
    expect(toDpeRecord({ ...REAL_LINE, etiquette_dpe: 'Z' })).toBeNull();
  });

  it('se rabat sur la date de reception quand l’etablissement manque', () => {
    const record = toDpeRecord({ ...REAL_LINE, date_etablissement_dpe: undefined });
    expect(record?.establishedAt.toISOString()).toBe('2026-08-10T00:00:00.000Z');
  });

  it('tolere une surface absente', () => {
    expect(toDpeRecord({ ...REAL_LINE, surface_habitable_logement: undefined })?.surfaceM2).toBeNull();
  });

  it('classe en "inconnu" un type de batiment non reconnu', () => {
    expect(toDpeRecord({ ...REAL_LINE, type_batiment: 'chalet' })?.buildingType).toBe('inconnu');
  });
});

describe('embeddedGeo', () => {
  it('exploite le geocodage deja present dans le jeu ADEME', () => {
    expect(embeddedGeo(REAL_LINE)).toEqual({
      banId: '86100_1860_00001',
      precision: 'HOUSENUMBER',
    });
  });

  it('degrade la precision quand le score BAN est douteux', () => {
    expect(embeddedGeo({ ...REAL_LINE, score_ban: 0.45 }).precision).toBe('STREET');
    expect(embeddedGeo({ ...REAL_LINE, score_ban: 0.2 }).precision).toBe('UNKNOWN');
  });

  it('renvoie UNKNOWN sur une adresse non geocodee par l’ADEME', () => {
    const geo = embeddedGeo({
      ...REAL_LINE,
      statut_geocodage: 'adresse non géocodée ban car aucune correspondance trouvée',
    });
    expect(geo.precision).toBe('UNKNOWN');
  });
});

describe('AdemeDpeSource', () => {
  it('filtre sur la date de reception et suit le curseur de data-fair', async () => {
    const calls: string[] = [];
    const source = new AdemeDpeSource({
      pageSize: 2,
      fetchImpl: (async (url: string) => {
        calls.push(url);
        const body =
          calls.length === 1
            ? { total: 3, next: 'https://data.ademe.fr/page2', results: [REAL_LINE] }
            : { total: 3, results: [REAL_LINE] };
        return new Response(JSON.stringify(body), { status: 200 });
      }) as unknown as typeof fetch,
    });

    const first = await source.fetchSince(new Date('2026-08-01T12:00:00Z'));
    expect(calls[0]).toContain('date_reception_dpe');
    expect(calls[0]).toContain('2026-08-01');
    expect(calls[0]).toContain('size=2');
    expect(first.records).toHaveLength(1);
    expect(first.nextCursor).toBe('https://data.ademe.fr/page2');

    const second = await source.fetchSince(new Date('2026-08-01T12:00:00Z'), first.nextCursor);
    expect(calls[1]).toBe('https://data.ademe.fr/page2');
    expect(second.nextCursor).toBeUndefined();
  });

  it('ecarte silencieusement les lignes inexploitables d’une page', async () => {
    const source = new AdemeDpeSource({
      fetchImpl: (async () =>
        new Response(
          JSON.stringify({ total: 2, results: [REAL_LINE, { numero_dpe: 'X' }] }),
          { status: 200 },
        )) as unknown as typeof fetch,
    });
    const { records } = await source.fetchSince(new Date('2026-08-01T00:00:00Z'));
    expect(records).toHaveLength(1);
  });

  it('signale une indisponibilite de l’API de facon explicite', async () => {
    const source = new AdemeDpeSource({
      fetchImpl: (async () => new Response('rate limited', { status: 429 })) as unknown as typeof fetch,
    });
    await expect(source.fetchSince(new Date())).rejects.toBeInstanceOf(AdemeUnavailableError);
  });
});

describe('toIsoDay', () => {
  it('tronque a la journee UTC', () => {
    expect(toIsoDay(new Date('2026-08-20T22:45:00Z'))).toBe('2026-08-20');
  });
});

describe('adressabilite reelle', () => {
  it('refuse le statut adressable a une voie sans numero', () => {
    // Constate le 20/08/2026 : l'ADEME declare "geocodee a l'adresse" une
    // ligne "Rue de la Krutenau 67000 Strasbourg" depourvue de numero.
    const geo = embeddedGeo({
      identifiant_ban: '67482_5480_00000',
      score_ban: 0.92,
      statut_geocodage: "adresse géocodée ban à l'adresse",
    });
    expect(geo.precision).toBe('STREET');
  });

  it('accepte un numero de voie reel', () => {
    expect(hasHouseNumber('33063_9315_00051')).toBe(true);
    expect(hasHouseNumber('33063_9315_00000')).toBe(false);
    expect(hasHouseNumber('malforme')).toBe(false);
  });
});
