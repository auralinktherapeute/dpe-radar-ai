import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  RATE_LIMIT_PER_MINUTE,
  authenticateApiKey,
  hashKey,
  rateLimit,
  resetRateLimits,
  setApiKeyReader,
} from '@interface/server/api-auth.js';
import type { Subscription } from '@domain/billing/Plan.js';
import { buildCallScript, detectsOpposition } from '@domain/compliance/CallScript.js';

const IDENTITY = {
  agencyName: 'Agence du Rhin',
  postalAddress: '3 place Kleber, 67000 Strasbourg',
  dpoContact: 'dpo@agence-du-rhin.fr',
  oppositionUrl: 'https://dperadar.ai/opposition',
};

const REASONS = [
  {
    signalId: 'DPE_RECENCY' as const,
    label: 'DPE realise il y a 2 mois',
    contribution: 34,
    source: 'ADEME' as const,
    observedAt: new Date('2026-06-12T00:00:00Z'),
  },
  {
    signalId: 'MARKET_VELOCITY' as const,
    label: 'Ventes du quartier +22 %',
    contribution: 11,
    source: 'DVF' as const,
    observedAt: new Date('2026-07-01T00:00:00Z'),
  },
];

describe('trame d’appel', () => {
  it('annonce l’origine des donnees des l’ouverture, pas en fin d’appel', () => {
    const script = buildCallScript({
      identity: IDENTITY,
      reasons: REASONS,
      basis: { kind: 'LEGITIMATE_INTEREST' },
    });
    // L'information doit etre delivree avant tout argumentaire.
    expect(script.opening.join(' ')).toContain('ADEME');
    expect(script.opening[0]).toContain('Agence du Rhin');
  });

  it('adapte l’ouverture a la base legale', () => {
    const consent = buildCallScript({
      identity: IDENTITY,
      reasons: REASONS,
      basis: { kind: 'EXPLICIT_CONSENT', grantedAt: new Date(), proofRef: 'f-1' },
    });
    expect(consent.opening.join(' ')).toContain('autorises a vous recontacter');

    const contrat = buildCallScript({
      identity: IDENTITY,
      reasons: REASONS,
      basis: { kind: 'EXISTING_CONTRACT', since: new Date() },
    });
    expect(contrat.opening.join(' ')).toContain('dossier que nous suivons');
  });

  it('date chaque point d’appui', () => {
    const script = buildCallScript({
      identity: IDENTITY,
      reasons: REASONS,
      basis: { kind: 'LEGITIMATE_INTEREST' },
    });
    expect(script.talkingPoints[0]).toContain('12/06/2026');
    expect(script.talkingPoints[0]).toContain('ADEME');
  });

  it('rappelle le droit d’opposition en sortie', () => {
    const script = buildCallScript({
      identity: IDENTITY,
      reasons: [],
      basis: { kind: 'LEGITIMATE_INTEREST' },
    });
    expect(script.closing.join(' ')).toContain('opposer');
    expect(script.closing.join(' ')).toContain(IDENTITY.dpoContact);
  });

  it('prepare une reponse a « comment avez-vous eu mon numero »', () => {
    const script = buildCallScript({
      identity: IDENTITY,
      reasons: [],
      basis: { kind: 'LEGITIMATE_INTEREST' },
    });
    const reponse = script.objections.find((o) => o.objection.includes('numero'))?.response ?? '';
    expect(reponse).toContain('pige');
    expect(reponse).toContain('licence');
  });

  it('ne presume jamais de l’intention de la personne', () => {
    const script = buildCallScript({
      identity: IDENTITY,
      reasons: REASONS,
      basis: { kind: 'LEGITIMATE_INTEREST' },
    });
    const texte = [...script.opening, ...script.talkingPoints, ...script.closing].join(' ');
    expect(texte).not.toMatch(/vous (vendez|voulez vendre|allez vendre)/i);
  });

  it('detecte une opposition exprimee a l’oral', () => {
    expect(detectsOpposition('Non merci, ne me rappelez plus.')).toBe(true);
    expect(detectsOpposition('Je m’oppose a ce traitement')).toBe(true);
    expect(detectsOpposition('Rappelez-moi la semaine prochaine')).toBe(false);
  });
});

describe('API ouverte', () => {
  const subscription: Subscription = {
    agencyId: 'a1',
    plan: 'PRO',
    status: 'ACTIVE',
    trialEndsAt: null,
    currentPeriodEnd: new Date('2026-12-01T00:00:00Z'),
    extraSeats: 0,
  };

  const VALID_KEY = 'k'.repeat(40);

  beforeEach(() => {
    resetRateLimits();
  });

  function request(authorization?: string): Request {
    return new Request('https://api.test/v1/scores?commune=33063', {
      headers: authorization ? { authorization } : {},
    });
  }

  it('refuse une requete sans en-tete Authorization', async () => {
    const result = await authenticateApiKey(request());
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('refuse une cle trop courte sans meme consulter le magasin', async () => {
    const result = await authenticateApiKey(request('Bearer court'));
    expect(result.ok).toBe(false);
  });

  it('est fermee par defaut, tant qu’aucun magasin de cles n’est branche', async () => {
    setApiKeyReader({ async find() { return null; } });
    const result = await authenticateApiKey(request(`Bearer ${VALID_KEY}`));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.status).toBe(401);
  });

  it('ne stocke jamais la cle en clair', async () => {
    let seen = '';
    setApiKeyReader({
      async find(hashed) {
        seen = hashed;
        return { agencyId: 'a1', subscription };
      },
    });
    await authenticateApiKey(request(`Bearer ${VALID_KEY}`));
    expect(seen).toBe(await hashKey(VALID_KEY));
    expect(seen).not.toContain(VALID_KEY);
    expect(seen).toHaveLength(64);
  });

  it('reserve l’API aux offres qui l’incluent', async () => {
    setApiKeyReader({
      async find() {
        return { agencyId: 'a1', subscription: { ...subscription, plan: 'STARTER' } };
      },
    });
    const result = await authenticateApiKey(request(`Bearer ${VALID_KEY}`));
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.status).toBe(403);
      expect(result.reason).toContain('Pro');
    }
  });

  it('accepte une cle valide sur une offre Pro', async () => {
    setApiKeyReader({ async find() { return { agencyId: 'a1', subscription }; } });
    const result = await authenticateApiKey(request(`Bearer ${VALID_KEY}`));
    expect(result.ok).toBe(true);
  });
});

describe('limitation de debit', () => {
  beforeEach(() => resetRateLimits());

  it('laisse passer jusqu’au quota, puis refuse', () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) {
      expect(rateLimit('a1', 1000).ok).toBe(true);
    }
    const refus = rateLimit('a1', 1000);
    expect(refus.ok).toBe(false);
    if (!refus.ok) expect(refus.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('compte par agence, pas globalement', () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) rateLimit('a1', 1000);
    expect(rateLimit('a2', 1000).ok).toBe(true);
  });

  it('rouvre la fenetre apres une minute', () => {
    for (let i = 0; i < RATE_LIMIT_PER_MINUTE; i += 1) rateLimit('a1', 1000);
    expect(rateLimit('a1', 1000).ok).toBe(false);
    expect(rateLimit('a1', 62_000).ok).toBe(true);
  });
});

describe('cle de developpement', () => {
  const ORIGINAL = { ...process.env };

  afterEach(() => {
    process.env = { ...ORIGINAL };
  });

  it('reste inactive sans variable d’environnement', async () => {
    delete process.env['DPE_DEV_API_KEY'];
    const { devKeyReaderIfEnabled } = await import('@interface/server/api-auth.js');
    expect(await devKeyReaderIfEnabled()).toBeNull();
  });

  it('refuse de s’activer en production, meme si la variable est presente', async () => {
    // Une variable laissee par megarde ne doit pas ouvrir l'API.
    process.env['DPE_DEV_API_KEY'] = 'd'.repeat(40);
    process.env['NODE_ENV'] = 'production';
    const { devKeyReaderIfEnabled } = await import('@interface/server/api-auth.js');
    expect(await devKeyReaderIfEnabled()).toBeNull();
  });

  it('n’accepte que la cle exacte', async () => {
    process.env['DPE_DEV_API_KEY'] = 'd'.repeat(40);
    process.env['NODE_ENV'] = 'development';
    const { devKeyReaderIfEnabled, hashKey } = await import('@interface/server/api-auth.js');
    const reader = await devKeyReaderIfEnabled();

    expect(await reader?.find(await hashKey('d'.repeat(40)))).not.toBeNull();
    expect(await reader?.find(await hashKey('autre'))).toBeNull();
  });
});
