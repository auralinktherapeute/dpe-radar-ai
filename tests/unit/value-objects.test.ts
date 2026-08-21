import { describe, expect, it } from 'vitest';
import { dpeRank, isDpeClass, isPassoireThermique } from '@domain/scoring/value-objects/DpeClass.js';
import {
  MIN_GEO_FOR_MAILING,
  fromBanResult,
  geoPrecisionWeight,
  isMailable,
} from '@domain/scoring/value-objects/GeoPrecision.js';
import { bandFor } from '@domain/scoring/entities/OpportunityScore.js';
import { SIGNAL_WEIGHTS, assertWeightsAreValid } from '@domain/scoring/signals/weights.js';

describe('DpeClass', () => {
  it('valide les etiquettes A-G et rejette le reste', () => {
    expect(isDpeClass('C')).toBe(true);
    expect(isDpeClass('H')).toBe(false);
    expect(isDpeClass('')).toBe(false);
  });

  it('ordonne les classes de A a G', () => {
    expect(dpeRank('A')).toBe(0);
    expect(dpeRank('G')).toBe(6);
  });

  it('identifie les passoires thermiques', () => {
    expect(isPassoireThermique('F')).toBe(true);
    expect(isPassoireThermique('G')).toBe(true);
    expect(isPassoireThermique('E')).toBe(false);
  });
});

describe('GeoPrecision', () => {
  it('traduit une reponse BAN en niveau de precision', () => {
    expect(fromBanResult('housenumber', 0.9)).toBe('HOUSENUMBER');
    expect(fromBanResult('street', 0.8)).toBe('STREET');
    expect(fromBanResult('municipality', 0.8)).toBe('MUNICIPALITY');
    expect(fromBanResult('locality', 0.8)).toBe('MUNICIPALITY');
    expect(fromBanResult('inconnu', 0.8)).toBe('UNKNOWN');
  });

  it('degrade tout resultat au score trop faible', () => {
    // Un appariement a 0,3 est un faux ami : mieux vaut declarer l'inconnu.
    expect(fromBanResult('housenumber', 0.3)).toBe('UNKNOWN');
  });

  it('n’autorise le courrier qu’a partir du seuil declare', () => {
    expect(geoPrecisionWeight('HOUSENUMBER')).toBeGreaterThanOrEqual(MIN_GEO_FOR_MAILING);
    expect(isMailable('HOUSENUMBER')).toBe(true);
    expect(isMailable('STREET')).toBe(true);
    expect(isMailable('MUNICIPALITY')).toBe(false);
    expect(isMailable('UNKNOWN')).toBe(false);
  });
});

describe('bandFor', () => {
  it('decoupe les bandes d’affichage', () => {
    expect(bandFor(95)).toBe('PRIORITAIRE');
    expect(bandFor(80)).toBe('PRIORITAIRE');
    expect(bandFor(79)).toBe('ELEVE');
    expect(bandFor(60)).toBe('ELEVE');
    expect(bandFor(59)).toBe('MODERE');
    expect(bandFor(35)).toBe('MODERE');
    expect(bandFor(34)).toBe('FAIBLE');
    expect(bandFor(0)).toBe('FAIBLE');
  });
});

describe('invariant du bareme', () => {
  it('accepte le bareme courant', () => {
    expect(() => assertWeightsAreValid()).not.toThrow();
  });

  it('les poids sont tous strictement positifs', () => {
    for (const weight of Object.values(SIGNAL_WEIGHTS)) {
      expect(weight).toBeGreaterThan(0);
    }
  });
});
