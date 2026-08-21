import { describe, expect, it } from 'vitest';
import {
  PigeImportSource,
  DEFAULT_MAPPING,
  priceDropRatio,
} from '@infrastructure/listings/PigeImportSource.js';
import {
  CONTACT_STALE_AFTER_DAYS,
  isCallableFrenchNumber,
  isContactStale,
  normalizePhone,
  usableContact,
} from '@domain/crm/Contact.js';
import type { Contact } from '@domain/crm/Contact.js';

const NOW = new Date('2026-08-20T09:00:00Z');

const HEADER =
  'identifiant_ban,statut,prix_initial,prix_actuel,telephone,email,type_vendeur,date_constat';

function source(now = NOW) {
  return new PigeImportSource(
    { kind: 'PIGE_LICENCE', sourceName: 'Pige Online', licenceRef: 'LIC-2026-4471' },
    () => now,
  );
}

describe('normalisation des numeros', () => {
  it('accepte les formats francais courants', () => {
    expect(normalizePhone('06 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('+33 6 12 34 56 78')).toBe('+33612345678');
    expect(normalizePhone('0033612345678')).toBe('+33612345678');
    expect(normalizePhone('06.12.34.56.78')).toBe('+33612345678');
  });

  it('rejette ce qui n’est pas composable plutot que de le laisser passer', () => {
    // Un numero errone compose par un negociateur coute plus cher
    // qu'un numero absent.
    expect(normalizePhone('12345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone(null)).toBeNull();
    expect(normalizePhone('+44 20 7946 0958')).toBeNull();
  });

  it('ecarte les numeros surtaxes, qui ne sont pas des lignes de particuliers', () => {
    expect(isCallableFrenchNumber('+33612345678')).toBe(true);
    expect(isCallableFrenchNumber('+33145678901')).toBe(true);
    expect(isCallableFrenchNumber('+33892701234')).toBe(false);
  });
});

describe('fraicheur des coordonnees', () => {
  const contact: Contact = {
    banId: '33063_9315_00051',
    phone: '+33612345678',
    email: null,
    provenance: {
      kind: 'PIGE_LICENCE',
      sourceName: 'Pige Online',
      licenceRef: 'LIC-1',
      observedAt: new Date('2026-08-15T00:00:00Z'),
    },
  };

  it('accepte une coordonnee recente', () => {
    expect(isContactStale(contact, NOW)).toBe(false);
    expect(usableContact(contact, NOW)).not.toBeNull();
  });

  it('ecarte une coordonnee trop ancienne', () => {
    const vieux: Contact = {
      ...contact,
      provenance: {
        ...contact.provenance,
        observedAt: new Date(NOW.getTime() - (CONTACT_STALE_AFTER_DAYS + 10) * 86_400_000),
      },
    };
    expect(usableContact(vieux, NOW)).toBeNull();
  });

  it('neutralise un numero non composable sans perdre l’email', () => {
    const result = usableContact({ ...contact, phone: '+33892701234', email: 'a@b.fr' }, NOW);
    expect(result?.phone).toBeNull();
    expect(result?.email).toBe('a@b.fr');
  });
});

describe('import depuis le logiciel de pige', () => {
  it('importe les annonces et rattache les coordonnees au bien', () => {
    const pige = source();
    const result = pige.importCsv(
      [
        HEADER,
        '33063_9315_00051,En ligne,320000,296000,06 12 34 56 78,vendeur@mail.fr,Particulier,18/08/2026',
        '33063_8120_00064,En ligne,450000,450000,,,Agence,17/08/2026',
      ].join('\n'),
    );

    expect(result.imported).toBe(2);
    expect(result.withPhone).toBe(1);
    expect(pige.size).toBe(2);
  });

  it('conserve la provenance de chaque numero — piece maitresse en cas de controle', () => {
    const pige = source();
    pige.importCsv(
      [HEADER, '33063_9315_00051,En ligne,320000,296000,0612345678,,Agence,18/08/2026'].join('\n'),
    );

    const contact = pige.contactFor('33063_9315_00051');
    expect(contact?.phone).toBe('+33612345678');
    expect(contact?.provenance.sourceName).toBe('Pige Online');
    expect(contact?.provenance.licenceRef).toBe('LIC-2026-4471');
    expect(contact?.provenance.kind).toBe('PIGE_LICENCE');
  });

  it('distingue une annonce de particulier — le regime applicable en depend', () => {
    const pige = source();
    pige.importCsv(
      [HEADER, '33063_9315_00051,En ligne,320000,296000,0612345678,,Particulier,18/08/2026'].join('\n'),
    );
    expect(pige.contactFor('33063_9315_00051')?.provenance.kind).toBe('ANNONCE_PARTICULIER');
  });

  it('motive les lignes rejetees au lieu de les perdre en silence', () => {
    const pige = source();
    const result = pige.importCsv(
      [
        HEADER,
        ',En ligne,320000,296000,0612345678,,Agence,18/08/2026',
        '33063_1_00002,En ligne,320000,296000,0612345678,,Agence,',
      ].join('\n'),
    );

    expect(result.imported).toBe(0);
    expect(result.rejected).toBe(2);
    expect(result.reasons.join(' ')).toContain('Identifiant BAN absent');
    expect(result.reasons.join(' ')).toContain('Date de constat');
  });

  it('alimente le Radar Annonces avec la baisse de prix constatee', async () => {
    const pige = source();
    pige.importCsv(
      [HEADER, '33063_9315_00051,En ligne,320000,296000,,,Agence,18/08/2026'].join('\n'),
    );

    const snapshot = await pige.snapshotFor({ banId: '33063_9315_00051', inseeCode: '33063' });
    expect(snapshot?.active).toBe(true);
    expect(snapshot?.priceDropRatio).toBeCloseTo(0.075, 3);
  });

  it('marque inactive une annonce retiree ou vendue', async () => {
    const pige = source();
    pige.importCsv(
      [
        HEADER,
        '33063_9315_00051,Retiree,320000,320000,,,Agence,18/08/2026',
        '33063_8120_00064,Vendu,450000,450000,,,Agence,18/08/2026',
      ].join('\n'),
    );
    expect((await pige.snapshotFor({ banId: '33063_9315_00051', inseeCode: '33063' }))?.active).toBe(false);
    expect((await pige.snapshotFor({ banId: '33063_8120_00064', inseeCode: '33063' }))?.active).toBe(false);
  });

  it('ne conclut rien sur un bien absent de la pige', async () => {
    const pige = source();
    // Absence de ligne = absence d'information, pas absence d'annonce.
    expect(await pige.snapshotFor({ banId: 'inconnu', inseeCode: '33063' })).toBeNull();
    expect(pige.contactFor('inconnu')).toBeNull();
    expect(pige.hasPhoneNumber('inconnu')).toBe(false);
  });

  it('accepte les dates ISO comme les dates francaises', () => {
    const pige = source();
    const result = pige.importCsv(
      [HEADER, '33063_9315_00051,En ligne,320000,296000,,,Agence,2026-08-18'].join('\n'),
    );
    expect(result.imported).toBe(1);
  });

  it('s’adapte au mapping de colonnes de l’editeur', () => {
    const pige = source();
    const result = pige.importCsv(
      ['ban,etat,px1,px2,tel,mail,vendeur,vu_le', '33063_9315_00051,actif,300000,280000,0612345678,,Agence,18/08/2026'].join('\n'),
      {
        ...DEFAULT_MAPPING,
        banId: 'ban',
        status: 'etat',
        priceInitial: 'px1',
        priceCurrent: 'px2',
        phone: 'tel',
        email: 'mail',
        sellerType: 'vendeur',
        observedAt: 'vu_le',
      },
    );
    expect(result.imported).toBe(1);
    expect(pige.contactFor('33063_9315_00051')?.phone).toBe('+33612345678');
  });

  it('n’invente pas de baisse sur une hausse', () => {
    expect(priceDropRatio(300000, 320000)).toBeNull();
    expect(priceDropRatio(null, 300000)).toBeNull();
  });
});
