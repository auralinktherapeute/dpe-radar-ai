import { describe, expect, it } from 'vitest';
import { evaluate } from '@domain/alerts/AlertRule.js';
import type { AlertCandidate, AlertContext, AlertRule } from '@domain/alerts/AlertRule.js';
import {
  OpenAiCopilot,
  UnsafeDraftError,
  CopilotUnavailableError,
  buildUserPrompt,
  findViolation,
} from '@infrastructure/llm/OpenAiCopilot.js';
import {
  DECLARATION_STALE_AFTER_DAYS,
  DeclaredListingSource,
  isStale,
  priceDropRatio,
} from '@infrastructure/listings/DeclaredListingSource.js';
import type { DeclaredListing } from '@infrastructure/listings/DeclaredListingSource.js';
import { HttpCrmConnector, classify, defaultMapping } from '@infrastructure/crm-connectors/CrmConnector.js';

const NOW = new Date('2026-08-20T09:00:00Z');

// ───────────────────────────── Alertes ─────────────────────────────

const rule: AlertRule = {
  id: 'r1',
  agencyId: 'a1',
  kind: 'NOUVEAU_SCORE_ELEVE',
  enabled: true,
  inseeCodes: ['33063'],
  minScore: 70,
  minConfidence: 60,
  dailyCap: 3,
};

const candidate: AlertCandidate = {
  banId: '33063_9315_00051',
  inseeCode: '33063',
  kind: 'NOUVEAU_SCORE_ELEVE',
  score: 82,
  confidence: 74,
  dpeClass: 'F',
  scoreDelta: null,
  occurredAt: NOW,
};

const context: AlertContext = { firedToday: 0, alreadyNotified: false, suppressed: false };

describe('alertes temps reel', () => {
  it('emet une alerte quand tous les seuils sont franchis', () => {
    const verdict = evaluate(rule, candidate, context);
    expect(verdict.fire).toBe(true);
    if (verdict.fire) expect(verdict.alert.headline).toContain('82');
  });

  it('n’alerte jamais sur un score peu fiable', () => {
    const verdict = evaluate(rule, { ...candidate, confidence: 35 }, context);
    expect(verdict.fire).toBe(false);
    if (!verdict.fire) expect(verdict.reason).toContain('Confiance');
  });

  it('respecte le plafond quotidien pour ne pas noyer le negociateur', () => {
    const verdict = evaluate(rule, candidate, { ...context, firedToday: 3 });
    expect(verdict.fire).toBe(false);
    if (!verdict.fire) expect(verdict.reason).toContain('Plafond quotidien');
  });

  it('ne signale pas deux fois le meme bien', () => {
    expect(evaluate(rule, candidate, { ...context, alreadyNotified: true }).fire).toBe(false);
  });

  it('une opposition prime sur toute preference d’alerte', () => {
    const verdict = evaluate(rule, candidate, { ...context, suppressed: true });
    expect(verdict.fire).toBe(false);
    if (!verdict.fire) expect(verdict.reason).toContain('suppression');
  });

  it('filtre par commune surveillee', () => {
    expect(evaluate(rule, { ...candidate, inseeCode: '75056' }, context).fire).toBe(false);
    const partout = evaluate({ ...rule, inseeCodes: [] }, { ...candidate, inseeCode: '75056' }, context);
    expect(partout.fire).toBe(true);
  });

  it('ignore une regle desactivee ou d’un autre type', () => {
    expect(evaluate({ ...rule, enabled: false }, candidate, context).fire).toBe(false);
    expect(evaluate({ ...rule, kind: 'BAISSE_DE_PRIX' }, candidate, context).fire).toBe(false);
  });

  it('exige une progression reelle pour une alerte de hausse', () => {
    const hausse: AlertRule = { ...rule, kind: 'SCORE_EN_HAUSSE' };
    expect(evaluate(hausse, { ...candidate, kind: 'SCORE_EN_HAUSSE', scoreDelta: 0 }, context).fire).toBe(false);
    expect(evaluate(hausse, { ...candidate, kind: 'SCORE_EN_HAUSSE', scoreDelta: 12 }, context).fire).toBe(true);
  });

  it('n’exige pas de score pour une baisse de prix', () => {
    const baisse: AlertRule = { ...rule, kind: 'BAISSE_DE_PRIX' };
    const verdict = evaluate(baisse, { ...candidate, kind: 'BAISSE_DE_PRIX', score: null }, context);
    expect(verdict.fire).toBe(true);
  });
});

// ───────────────────────────── Copilote ─────────────────────────────

describe('copilote IA', () => {
  function copilot(reply: string, status = 200) {
    return new OpenAiCopilot({
      apiKey: 'test',
      fetchImpl: (async () =>
        new Response(JSON.stringify({ choices: [{ message: { content: reply } }] }), {
          status,
        })) as unknown as typeof fetch,
    });
  }

  const input = {
    channel: 'POSTAL_MAIL' as const,
    reasons: [
      {
        signalId: 'DPE_RECENCY' as const,
        label: 'DPE realise il y a 2 mois',
        contribution: 28,
        source: 'ADEME' as const,
        observedAt: NOW,
      },
    ],
    identity: {
      agencyName: 'Agence du Rhin',
      postalAddress: '3 place Kleber',
      dpoContact: 'dpo@test.fr',
      oppositionUrl: 'https://test.fr/opposition',
    },
  };

  it('ne transmet au modele aucune donnee identifiante', () => {
    const prompt = buildUserPrompt(input.channel, input.reasons, input.identity);
    expect(prompt).not.toMatch(/\d{5}_\d+_\d+/); // pas d'identifiant BAN
    expect(prompt).not.toContain('Rue');
    expect(prompt).toContain('DPE realise il y a 2 mois');
  });

  it('accepte un brouillon sobre', async () => {
    const draft = await copilot('Bonjour,\n\nLe marche de votre quartier evolue...').draft(input);
    expect(draft).toContain('Bonjour');
  });

  it.each([
    'Votre bien est a vendre, nous le savons.',
    'Nous savons que vous vendez cette annee.',
    'J’ai un acquereur pour votre maison.',
    'Nous avons un acheteur immediat.',
    'Vente garantie en 30 jours.',
  ])('rejette un brouillon qui affirme sans preuve : %s', async (text) => {
    await expect(copilot(text).draft(input)).rejects.toBeInstanceOf(UnsafeDraftError);
  });

  it('signale une indisponibilite de l’API', async () => {
    const failing = new OpenAiCopilot({
      apiKey: 'test',
      fetchImpl: (async () => new Response('nope', { status: 500 })) as unknown as typeof fetch,
    });
    await expect(failing.draft(input)).rejects.toBeInstanceOf(CopilotUnavailableError);
  });

  it('detecte la formulation exacte en cause', () => {
    expect(findViolation('Bonjour, votre appartement est en vente.')).toBeTruthy();
    expect(findViolation('Bonjour, voici un point de marche.')).toBeNull();
  });
});

// ──────────────────────── Radar Annonces ────────────────────────

describe('Radar Annonces — source declarative', () => {
  function source(listing: DeclaredListing | null, now = NOW) {
    return new DeclaredListingSource({ async findByBanId() { return listing; } }, () => now);
  }

  const declared: DeclaredListing = {
    banId: '33063_9315_00051',
    active: true,
    initialPrice: 320000,
    currentPrice: 296000,
    declaredBy: 'u1',
    observedAt: new Date('2026-08-18T00:00:00Z'),
  };

  it('ne conclut rien en l’absence de declaration', async () => {
    // Renvoyer "aucune annonce active" serait une affirmation que personne
    // n'a verifiee — c'est ainsi qu'on propose un bien deja en vente.
    expect(await source(null).snapshotFor({ banId: 'x', inseeCode: '33063' })).toBeNull();
  });

  it('expose la baisse de prix constatee', async () => {
    const snapshot = await source(declared).snapshotFor({ banId: declared.banId, inseeCode: '33063' });
    expect(snapshot?.active).toBe(true);
    expect(snapshot?.priceDropRatio).toBeCloseTo(0.075, 3);
  });

  it('ignore une declaration perimee', async () => {
    const vieille = {
      ...declared,
      observedAt: new Date(NOW.getTime() - (DECLARATION_STALE_AFTER_DAYS + 5) * 86_400_000),
    };
    expect(await source(vieille).snapshotFor({ banId: declared.banId, inseeCode: '33063' })).toBeNull();
    expect(isStale(vieille.observedAt, NOW)).toBe(true);
  });

  it('n’invente pas de baisse sur une hausse ou un prix manquant', () => {
    expect(priceDropRatio(300000, 320000)).toBeNull();
    expect(priceDropRatio(null, 300000)).toBeNull();
    expect(priceDropRatio(300000, null)).toBeNull();
    expect(priceDropRatio(0, 100)).toBeNull();
  });
});

// ──────────────────────── Connecteurs CRM ────────────────────────

describe('connecteurs CRM', () => {
  const payload = {
    externalRef: 'dpe-1',
    address: '51 Cours Victor Hugo',
    inseeCode: '33063',
    score: 78,
    confidence: 74,
    reasons: ['DPE recent', 'Quartier en hausse'],
    stage: 'CONTACTE',
    sourceLabel: 'DPE Radar AI',
  };

  it('pousse le contact et renvoie l’identifiant distant', async () => {
    const connector = new HttpCrmConnector('APIMO', {
      baseUrl: 'https://api.test',
      apiKey: 'k',
      fetchImpl: (async () => new Response(JSON.stringify({ id: 'remote-9' }), { status: 201 })) as unknown as typeof fetch,
    });
    const result = await connector.push(payload);
    expect(result).toEqual({ ok: true, remoteId: 'remote-9' });
  });

  it('ne fait pas echouer le pipeline quand le CRM de l’agence tombe', async () => {
    const connector = new HttpCrmConnector('HEKTOR', {
      baseUrl: 'https://api.test',
      apiKey: 'k',
      fetchImpl: (async () => {
        throw new Error('ECONNRESET');
      }) as unknown as typeof fetch,
    });
    const result = await connector.push(payload);
    expect(result).toEqual({ ok: false, code: 'UNAVAILABLE', message: 'HEKTOR est injoignable.' });
  });

  it('classe les erreurs pour permettre un reessai pertinent', () => {
    expect(classify(401)).toBe('AUTH');
    expect(classify(403)).toBe('AUTH');
    expect(classify(429)).toBe('RATE_LIMIT');
    expect(classify(422)).toBe('VALIDATION');
    expect(classify(503)).toBe('UNAVAILABLE');
  });

  it('ne transmet aucune identite de proprietaire', () => {
    const mapped = JSON.stringify(defaultMapping(payload));
    expect(mapped).toContain('dpe_radar_score');
    expect(mapped).not.toMatch(/"(email|phone|telephone|nom|lastname)"/i);
  });
});
