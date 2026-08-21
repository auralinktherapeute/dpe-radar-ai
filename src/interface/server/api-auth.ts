import { Entitlements } from '@domain/billing/Plan.js';
import type { Subscription } from '@domain/billing/Plan.js';

/**
 * Authentification des cles d'API et limitation de debit.
 *
 * En production, les cles sont stockees hachees en base et l'abonnement est lu
 * via Prisma. Ce module isole la logique pour qu'elle reste testable et que
 * les routes n'aient pas a la reimplementer.
 */
export type ApiAuthResult =
  | { readonly ok: true; readonly agencyId: string; readonly subscription: Subscription }
  | { readonly ok: false; readonly status: number; readonly reason: string };

export interface ApiKeyReader {
  find(hashedKey: string): Promise<{ agencyId: string; subscription: Subscription } | null>;
}

let keyReader: ApiKeyReader = {
  // Implementation par defaut : aucune cle valide. L'API est fermee tant que
  // le magasin de cles n'est pas branche — c'est le bon defaut.
  async find() {
    return null;
  },
};

/**
 * Cle de developpement.
 *
 * Activee uniquement si `DPE_DEV_API_KEY` est definie ET que l'on n'est pas en
 * production. Elle sert a faire tourner l'application mobile et les
 * integrations en local sans monter une base de cles.
 *
 * La double condition est volontaire : une variable d'environnement laissee
 * par megarde en production ne doit pas ouvrir l'API.
 */
export async function devKeyReaderIfEnabled(): Promise<ApiKeyReader | null> {
  const devKey = process.env['DPE_DEV_API_KEY'];
  if (!devKey || process.env['NODE_ENV'] === 'production') return null;

  const expected = await hashKey(devKey);
  return {
    async find(hashed) {
      if (hashed !== expected) return null;
      return {
        agencyId: 'agence-de-developpement',
        subscription: {
          agencyId: 'agence-de-developpement',
          plan: 'PRO',
          status: 'ACTIVE',
          trialEndsAt: null,
          currentPeriodEnd: null,
          extraSeats: 0,
        },
      };
    },
  };
}

export function setApiKeyReader(reader: ApiKeyReader): void {
  keyReader = reader;
}

export async function authenticateApiKey(request: Request): Promise<ApiAuthResult> {
  const devReader = await devKeyReaderIfEnabled();
  if (devReader) keyReader = devReader;

  const header = request.headers.get('authorization');
  if (!header?.startsWith('Bearer ')) {
    return { ok: false, status: 401, reason: 'En-tete Authorization manquant ou mal forme.' };
  }

  const presented = header.slice(7).trim();
  if (presented.length < 32) {
    return { ok: false, status: 401, reason: 'Cle d’API invalide.' };
  }

  const record = await keyReader.find(await hashKey(presented));
  if (!record) {
    return { ok: false, status: 401, reason: 'Cle d’API inconnue ou revoquee.' };
  }

  const decision = new Entitlements().can(record.subscription, 'OPEN_API');
  if (!decision.allowed) {
    return { ok: false, status: 403, reason: decision.reason };
  }

  return { ok: true, agencyId: record.agencyId, subscription: record.subscription };
}

/** Hachage SHA-256 : la cle en clair n'est jamais stockee. */
export async function hashKey(key: string): Promise<string> {
  const bytes = new TextEncoder().encode(key);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export const RATE_LIMIT_PER_MINUTE = 60;

const windows = new Map<string, { count: number; resetAt: number }>();

export type RateLimitResult =
  | { readonly ok: true; readonly remaining: number }
  | { readonly ok: false; readonly retryAfterSeconds: number };

/**
 * Fenetre glissante par minute et par agence.
 * En memoire ici ; en production, le compteur vit dans Redis pour tenir sur
 * plusieurs instances.
 */
export function rateLimit(agencyId: string, now = Date.now()): RateLimitResult {
  const window = windows.get(agencyId);

  if (!window || window.resetAt <= now) {
    windows.set(agencyId, { count: 1, resetAt: now + 60_000 });
    return { ok: true, remaining: RATE_LIMIT_PER_MINUTE - 1 };
  }

  if (window.count >= RATE_LIMIT_PER_MINUTE) {
    return { ok: false, retryAfterSeconds: Math.ceil((window.resetAt - now) / 1000) };
  }

  window.count += 1;
  return { ok: true, remaining: RATE_LIMIT_PER_MINUTE - window.count };
}

export function resetRateLimits(): void {
  windows.clear();
}
