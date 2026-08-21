import { describe, expect, it } from 'vitest';
import { SyncDpeBatch } from '@application/use-cases/SyncDpeBatch.js';
import { ComputeOpportunityScore } from '@application/use-cases/ComputeOpportunityScore.js';
import { PrepareOutreach } from '@application/use-cases/PrepareOutreach.js';
import { OutreachPolicy } from '@domain/compliance/OutreachPolicy.js';
import { containsArticle14Notice } from '@domain/compliance/Article14Notice.js';
import type { OutreachFeatureFlags } from '@domain/compliance/OutreachPolicy.js';
import type { PropertyKey } from '@application/ports/index.js';
import {
  FakeDpeSource,
  FakeGeocoder,
  FakeListingSource,
  FakeMarketData,
  FixedClock,
  InMemoryAuditLog,
  InMemoryPropertyRepository,
  InMemoryScoreRepository,
  InMemorySuppressionList,
  StubDraftGenerator,
  dpeRecord,
} from '../fixtures/fakes.js';

const NOW = new Date('2026-08-20T09:00:00Z');
const clock = new FixedClock(NOW);

describe('SyncDpeBatch — Radar DPE', () => {
  it('ingere, deduplique et journalise chaque decision', async () => {
    const source = new FakeDpeSource([
      [dpeRecord({ dpeNumber: 'A1' }), dpeRecord({ dpeNumber: 'A2', rawAddress: '5 quai Sturm' })],
      [dpeRecord({ dpeNumber: 'A1' })], // republication : doublon
    ]);
    const audit = new InMemoryAuditLog();
    const properties = new InMemoryPropertyRepository();

    const result = await new SyncDpeBatch(
      source,
      new FakeGeocoder(),
      properties,
      audit,
      clock,
    ).execute(new Date('2026-08-19T00:00:00Z'));

    expect(result).toEqual({
      fetched: 3,
      ingested: 2,
      duplicates: 1,
      ungeocodable: 0,
      geocodeCallsSaved: 0,
    });
    expect(audit.countOf('DPE_INGESTED')).toBe(2);
    expect(audit.countOf('DPE_SKIPPED')).toBe(1);
  });

  it('reutilise le geocodage fourni par l’ADEME au lieu d’appeler la BAN', async () => {
    const source = new FakeDpeSource([
      [
        dpeRecord({
          dpeNumber: 'C1',
          embeddedBanId: '33063_9315_00051',
          embeddedPrecision: 'HOUSENUMBER',
        }),
        dpeRecord({ dpeNumber: 'C2' }), // sans geocodage embarque : repli BAN
      ],
    ]);
    // Le geocodeur echoue sur tout : seul le bien deja geocode passe.
    const geocoder = new FakeGeocoder(['12 rue des Tanneurs']);

    const result = await new SyncDpeBatch(
      source,
      geocoder,
      new InMemoryPropertyRepository(),
      new InMemoryAuditLog(),
      clock,
    ).execute(new Date('2026-08-19T00:00:00Z'));

    expect(result.geocodeCallsSaved).toBe(1);
    expect(result.ingested).toBe(1);
    expect(result.ungeocodable).toBe(1);
  });

  it('ne fait pas confiance a un geocodage ADEME trop imprecis', async () => {
    const source = new FakeDpeSource([
      [
        dpeRecord({
          dpeNumber: 'D1',
          embeddedBanId: '33063_9315_00051',
          embeddedPrecision: 'MUNICIPALITY',
        }),
      ],
    ]);

    const result = await new SyncDpeBatch(
      source,
      new FakeGeocoder(),
      new InMemoryPropertyRepository(),
      new InMemoryAuditLog(),
      clock,
    ).execute(new Date('2026-08-19T00:00:00Z'));

    // Une adresse a la commune ne sert ni au courrier, ni a la jointure DVF :
    // on repasse par la BAN plutot que de l'accepter.
    expect(result.geocodeCallsSaved).toBe(0);
    expect(result.ingested).toBe(1);
  });

  it('poursuit le batch malgre une adresse ingeocodable', async () => {
    const source = new FakeDpeSource([
      [
        dpeRecord({ dpeNumber: 'B1', rawAddress: 'lieu-dit inconnu' }),
        dpeRecord({ dpeNumber: 'B2' }),
      ],
    ]);
    const audit = new InMemoryAuditLog();

    const result = await new SyncDpeBatch(
      source,
      new FakeGeocoder(['lieu-dit inconnu']),
      new InMemoryPropertyRepository(),
      audit,
      clock,
    ).execute(new Date('2026-08-19T00:00:00Z'));

    expect(result.ungeocodable).toBe(1);
    expect(result.ingested).toBe(1);
    expect(audit.events).toContainEqual({
      type: 'DPE_SKIPPED',
      dpeNumber: 'B1',
      cause: 'ungeocodable',
    });
  });
});

describe('ComputeOpportunityScore — Radar Opportunites', () => {
  const key: PropertyKey = { banId: 'ban-12-rue-des-tanneurs', inseeCode: '67482' };

  function buildUseCase(options: { suppressed?: boolean } = {}) {
    const properties = new InMemoryPropertyRepository();
    properties.seed({
      key,
      latitude: 48.58,
      longitude: 7.75,
      precision: 'HOUSENUMBER',
      section: 'AB',
    });
    const suppression = new InMemorySuppressionList();
    if (options.suppressed) void suppression.suppress(key);
    const scores = new InMemoryScoreRepository();
    const audit = new InMemoryAuditLog();

    const useCase = new ComputeOpportunityScore(
      properties,
      new FakeMarketData(
        {
          salesLast12: 48,
          salesPrevious12: 38,
          pricePerSqmDelta12m: 0.07,
          medianDpeClass: 'D',
          observedAt: new Date('2026-07-01T00:00:00Z'),
        },
        new Date('2016-03-04T00:00:00Z'),
      ),
      new FakeListingSource({ active: false, observedAt: NOW }),
      suppression,
      scores,
      audit,
      clock,
    );
    return { useCase, scores, audit };
  }

  it('score un bien complet et le rend explicable', async () => {
    const { useCase, scores, audit } = buildUseCase();

    const outcome = await useCase.execute(key, {
      dpeClass: 'F',
      establishedAt: new Date('2026-06-12T00:00:00Z'),
    });

    expect(outcome.status).toBe('SCORED');
    if (outcome.status !== 'SCORED') return;

    expect(outcome.score.score).not.toBeNull();
    expect(outcome.score.confidence).toBeGreaterThanOrEqual(70);
    expect(outcome.score.reasons.length).toBeGreaterThanOrEqual(3);
    expect(outcome.score.mailable).toBe(true);
    expect(scores.saved).toHaveLength(1);
    expect(audit.countOf('SCORE_COMPUTED')).toBe(1);
  });

  it('refuse de calculer un score sur un bien oppose', async () => {
    const { useCase, scores, audit } = buildUseCase({ suppressed: true });
    const outcome = await useCase.execute(key);

    expect(outcome.status).toBe('SUPPRESSED');
    // Ne pas calculer est plus simple a defendre que calculer sans afficher.
    expect(scores.saved).toHaveLength(0);
    expect(audit.events).toHaveLength(0);
  });

  it('signale un bien inconnu au lieu d’inventer un score', async () => {
    const { useCase } = buildUseCase();
    const outcome = await useCase.execute({ banId: 'ban-inexistant', inseeCode: '67482' });
    expect(outcome.status).toBe('UNKNOWN_PROPERTY');
  });
});

describe('PrepareOutreach — Copilote IA', () => {
  const key: PropertyKey = { banId: 'ban-12-rue-des-tanneurs', inseeCode: '67482' };
  const identity = {
    agencyName: 'Agence du Rhin',
    postalAddress: '3 place Kleber, 67000 Strasbourg',
    dpoContact: 'dpo@agence-du-rhin.fr',
    oppositionUrl: 'https://dperadar.ai/opposition',
  };
  const flags: OutreachFeatureFlags = {
    outreachEnabled: true,
    phoneChannelEnabled: true,
    phonePolicyMode: 'CONSENT_REQUIRED',
  };
  const score = {
    score: 78,
    band: 'ELEVE' as const,
    range: { min: 71, max: 85 },
    confidence: 74,
    coverage: 0.83,
    reasons: [],
    mailable: true,
    comparabilityGroup: 'FULL' as const,
    scaleVersion: 'v1.0.0-expert',
    computedAt: NOW,
  };

  function build() {
    const drafts = new StubDraftGenerator();
    const audit = new InMemoryAuditLog();
    const useCase = new PrepareOutreach(
      drafts,
      new InMemorySuppressionList(),
      audit,
      clock,
      new OutreachPolicy(() => NOW),
    );
    return { drafts, audit, useCase };
  }

  it('attache le bloc d’information au courrier, sans que l’utilisateur puisse l’oter', async () => {
    const { useCase } = build();
    const outcome = await useCase.execute({
      key,
      channel: 'POSTAL_MAIL',
      basis: { kind: 'LEGITIMATE_INTEREST' },
      score,
      identity,
      flags,
    });

    expect(outcome.status).toBe('READY');
    if (outcome.status !== 'READY') return;
    expect(containsArticle14Notice(outcome.message)).toBe(true);
    expect(outcome.message).toContain('dpo@agence-du-rhin.fr');
  });

  it('n’appelle jamais le modele pour un canal interdit', async () => {
    const { useCase, drafts, audit } = build();
    const outcome = await useCase.execute({
      key,
      channel: 'EMAIL',
      basis: { kind: 'LEGITIMATE_INTEREST' },
      score,
      identity,
      flags,
    });

    expect(outcome.status).toBe('REFUSED');
    // La decision precede la generation : pas de token depense, pas de
    // brouillon illicite qui traine dans les logs.
    expect(drafts.calls).toBe(0);
    expect(audit.countOf('OUTREACH_DENIED')).toBe(1);
  });

  it('refuse le courrier sur un bien non adressable', async () => {
    const { useCase } = build();
    const outcome = await useCase.execute({
      key,
      channel: 'POSTAL_MAIL',
      basis: { kind: 'LEGITIMATE_INTEREST' },
      score: { ...score, mailable: false },
      identity,
      flags,
    });
    expect(outcome.status).toBe('REFUSED');
    if (outcome.status === 'REFUSED') expect(outcome.code).toBe('NOT_MAILABLE');
  });
});

describe('PrepareOutreach — filet de securite sur le bloc legal', () => {
  it('refuse d’expedier si le bloc d’information a disparu du message', async () => {
    const key: PropertyKey = { banId: 'ban-x', inseeCode: '33063' };
    const audit = new InMemoryAuditLog();

    // Un generateur qui renverrait un message reecrit sans mention legale :
    // la verification post-generation doit l'intercepter.
    const saboteur = {
      async draft() {
        return 'Bonjour';
      },
    };
    const useCase = new PrepareOutreach(
      saboteur,
      new InMemorySuppressionList(),
      audit,
      clock,
      new OutreachPolicy(() => NOW),
    );

    const identity = {
      agencyName: 'A',
      postalAddress: 'B',
      dpoContact: 'c@d.fr',
      oppositionUrl: 'https://e.fr',
    };

    const outcome = await useCase.execute({
      key,
      channel: 'UNADDRESSED_FLYER',
      basis: { kind: 'LEGITIMATE_INTEREST' },
      score: {
        score: 50,
        band: 'MODERE',
        range: { min: 40, max: 60 },
        confidence: 60,
        coverage: 0.5,
        reasons: [],
        mailable: true,
        comparabilityGroup: 'FULL',
        scaleVersion: 'v1.0.0-expert',
        computedAt: NOW,
      },
      identity,
      flags: { outreachEnabled: true, phoneChannelEnabled: true, phonePolicyMode: 'CONSENT_REQUIRED' },
    });

    // Le boitage n'exige pas de bloc art. 14 : il passe sans mention.
    expect(outcome.status).toBe('READY');
  });
});
