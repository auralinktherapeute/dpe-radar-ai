import { describe, expect, it } from 'vitest';
import { OutreachPolicy } from '@domain/compliance/OutreachPolicy.js';
import type {
  LegalBasis,
  OutreachChannel,
  OutreachFeatureFlags,
  OutreachRequest,
} from '@domain/compliance/OutreachPolicy.js';
import {
  buildArticle14Notice,
  containsArticle14Notice,
} from '@domain/compliance/Article14Notice.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const policy = new OutreachPolicy(() => NOW);

const DEFAULT_FLAGS: OutreachFeatureFlags = {
  outreachEnabled: true,
  phoneChannelEnabled: true,
  phonePolicyMode: 'CONSENT_REQUIRED',
};

/** Agence qui assume l'appel sur interet legitime. */
const LIABILITY_FLAGS: OutreachFeatureFlags = {
  ...DEFAULT_FLAGS,
  phonePolicyMode: 'AGENCY_RESPONSIBILITY',
};

const LEGITIMATE: LegalBasis = { kind: 'LEGITIMATE_INTEREST' };
const CONSENT: LegalBasis = {
  kind: 'EXPLICIT_CONSENT',
  grantedAt: new Date('2026-08-01T00:00:00Z'),
  proofRef: 'form-2026-08-01-8842',
};

function request(
  channel: OutreachChannel,
  overrides: Partial<OutreachRequest> = {},
): OutreachRequest {
  return {
    channel,
    basis: LEGITIMATE,
    suppressed: false,
    mailable: true,
    hasPhoneNumber: true,
    flags: DEFAULT_FLAGS,
    ...overrides,
  };
}

describe('canal telephone — regime du 11 aout 2026', () => {
  it('refuse l’appel quand le canal est desactive par l’agence', () => {
    const decision = policy.decide(
      request('PHONE', { flags: { ...DEFAULT_FLAGS, phoneChannelEnabled: false } }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('PHONE_CHANNEL_DISABLED');
  });

  it('refuse l’appel a froid sous le regime « consentement requis »', () => {
    const decision = policy.decide(request('PHONE'));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('PHONE_REQUIRES_CONSENT');
  });

  it('autorise l’appel a un client sous contrat en cours — exception legale', () => {
    const decision = policy.decide(
      request('PHONE', {
        basis: { kind: 'EXISTING_CONTRACT', since: new Date('2024-01-01T00:00:00Z') },
      }),
    );
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.basisClaimed).toBe('EXISTING_CONTRACT');
  });

  it('autorise l’appel sur consentement valide et prouve', () => {
    const decision = policy.decide(request('PHONE', { basis: CONSENT }));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.basisClaimed).toBe('EXPLICIT_CONSENT');
  });

  it('refuse l’appel sur consentement revoque', () => {
    const decision = policy.decide(
      request('PHONE', {
        basis: { ...CONSENT, kind: 'EXPLICIT_CONSENT', revokedAt: new Date('2026-08-10T00:00:00Z') },
      }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('CONSENT_REVOKED');
  });

  it('autorise l’appel sur interet legitime quand l’agence en assume le regime', () => {
    const decision = policy.decide(request('PHONE', { flags: LIABILITY_FLAGS }));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) {
      expect(decision.basisClaimed).toBe('LEGITIMATE_INTEREST');
      // La mention de responsabilite est attachee a la decision et journalisee.
      expect(decision.agencyLiability).toContain('responsabilite de l’agence');
      expect(decision.requiresArticle14Notice).toBe(true);
    }
  });

  it('refuse de preparer un appel sans numero connu', () => {
    const decision = policy.decide(
      request('PHONE', { flags: LIABILITY_FLAGS, hasPhoneNumber: false }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) {
      expect(decision.code).toBe('NO_PHONE_NUMBER');
      // Les numeros viennent de la pige sous licence, jamais de l'open data.
      expect(decision.reason).toContain('pige');
    }
  });

  it('une opposition prime meme sur un consentement valide', () => {
    const decision = policy.decide(
      request('PHONE', { basis: CONSENT, suppressed: true, flags: LIABILITY_FLAGS }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('SUPPRESSED');
  });
});

describe('prospection electronique — art. L34-5 CPCE', () => {
  it.each(['EMAIL', 'SMS'] as const)('refuse le %s a froid', (channel) => {
    const decision = policy.decide(request(channel));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('ELECTRONIC_REQUIRES_OPT_IN');
  });

  it.each(['EMAIL', 'SMS'] as const)('autorise le %s sur opt-in', (channel) => {
    expect(policy.decide(request(channel, { basis: CONSENT })).allowed).toBe(true);
  });

  it('autorise l’email a un client existant pour un service analogue', () => {
    const decision = policy.decide(
      request('EMAIL', {
        basis: { kind: 'EXISTING_CONTRACT', since: new Date('2025-05-01T00:00:00Z') },
      }),
    );
    expect(decision.allowed).toBe(true);
  });
});

describe('courrier adresse — canal principal', () => {
  it('autorise le courrier sur interet legitime, avec information obligatoire', () => {
    const decision = policy.decide(request('POSTAL_MAIL'));
    expect(decision.allowed).toBe(true);
    if (decision.allowed) expect(decision.requiresArticle14Notice).toBe(true);
  });

  it('refuse le courrier quand le geocodage est trop imprecis', () => {
    const decision = policy.decide(request('POSTAL_MAIL', { mailable: false }));
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('NOT_MAILABLE');
  });
});

describe('liste de suppression', () => {
  it('prime sur toute base legale, consentement compris', () => {
    const decision = policy.decide(
      request('POSTAL_MAIL', { suppressed: true, basis: CONSENT }),
    );
    expect(decision.allowed).toBe(false);
    if (!decision.allowed) expect(decision.code).toBe('SUPPRESSED');
  });

  it('laisse passer le boitage non adresse, qui ne traite aucune donnee personnelle', () => {
    expect(policy.decide(request('UNADDRESSED_FLYER', { suppressed: true })).allowed).toBe(true);
  });
});

describe('coupe-circuit global', () => {
  it.each(['POSTAL_MAIL', 'EMAIL', 'UNADDRESSED_FLYER', 'DOOR_TO_DOOR'] as const)(
    'coupe le canal %s sans discuter',
    (channel) => {
      const decision = policy.decide(
        request(channel, {
          basis: CONSENT,
          flags: { ...LIABILITY_FLAGS, outreachEnabled: false },
        }),
      );
      expect(decision.allowed).toBe(false);
      if (!decision.allowed) expect(decision.code).toBe('OUTREACH_DISABLED');
    },
  );
});

describe('canaux proposes sur un bien froid', () => {
  it('ne propose ni email ni SMS, jamais', () => {
    const channels = policy.availableChannelsForColdProperty({
      mailable: true,
      hasPhoneNumber: true,
      flags: LIABILITY_FLAGS,
    });
    expect(channels).not.toContain('EMAIL');
    expect(channels).not.toContain('SMS');
  });

  it('propose le telephone quand l’agence l’a active et dispose d’un numero', () => {
    const channels = policy.availableChannelsForColdProperty({
      mailable: true,
      hasPhoneNumber: true,
      flags: LIABILITY_FLAGS,
    });
    expect(channels[0]).toBe('PHONE');
  });

  it('retire le telephone faute de numero issu de la pige', () => {
    const channels = policy.availableChannelsForColdProperty({
      mailable: true,
      hasPhoneNumber: false,
      flags: LIABILITY_FLAGS,
    });
    expect(channels).not.toContain('PHONE');
    expect(channels[0]).toBe('POSTAL_MAIL');
  });

  it('retire le telephone sous le regime « consentement requis »', () => {
    const channels = policy.availableChannelsForColdProperty({
      mailable: true,
      hasPhoneNumber: true,
      flags: DEFAULT_FLAGS,
    });
    expect(channels).not.toContain('PHONE');
  });

  it('retire le courrier quand le bien n’est pas adressable', () => {
    const channels = policy.availableChannelsForColdProperty({
      mailable: false,
      hasPhoneNumber: false,
      flags: DEFAULT_FLAGS,
    });
    expect(channels).not.toContain('POSTAL_MAIL');
  });
});

describe('bloc d’information art. 14', () => {
  const notice = buildArticle14Notice({
    agencyName: 'Agence Test',
    postalAddress: '12 rue de la Paix, 67000 Strasbourg',
    dpoContact: 'dpo@agence-test.fr',
    oppositionUrl: 'https://dperadar.ai/opposition',
  });

  it('mentionne la source des donnees, exigence CNIL', () => {
    expect(notice).toContain('ADEME');
    expect(notice).toContain('DVF');
  });

  it('expose le droit d’opposition et le contact', () => {
    expect(notice).toContain('OPPOSITION');
    expect(notice).toContain('dpo@agence-test.fr');
    expect(notice).toContain('https://dperadar.ai/opposition');
  });

  it('detecte un message ampute de son bloc d’information', () => {
    expect(containsArticle14Notice(`Bonjour,\n\n${notice}`)).toBe(true);
    expect(containsArticle14Notice('Bonjour, je vends votre maison.')).toBe(false);
  });
});
