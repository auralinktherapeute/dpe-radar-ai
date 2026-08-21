import Redis from 'ioredis';

/**
 * Cache Redis.
 *
 * Deux usages, avec des durees tres differentes :
 *  - les statistiques DVF changent au rythme des publications (trimestriel) :
 *    on les garde longtemps ;
 *  - les scores changent tous les jours, puisque la fraicheur du DPE est le
 *    signal dominant : on les garde peu.
 *
 * Une seule duree pour les deux gaspillerait soit de la memoire, soit de la
 * pertinence.
 */
export const TTL = {
  /** Statistiques de quartier : DVF publie par vagues. */
  NEIGHBOURHOOD_STATS: 60 * 60 * 24 * 7,
  /** Score d'un bien : recalcule quotidiennement. */
  SCORE: 60 * 60 * 12,
  /** Reponse ADEME paginee : evite de repayer la pagination profonde. */
  ADEME_PAGE: 60 * 30,
} as const;

export interface CachePort {
  get<T>(key: string): Promise<T | null>;
  set<T>(key: string, value: T, ttlSeconds: number): Promise<void>;
  invalidate(pattern: string): Promise<number>;
}

export class RedisCache implements CachePort {
  private readonly client: Redis;

  constructor(url: string, client?: Redis) {
    this.client = client ?? new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: true });
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.client.get(key);
      return raw ? (JSON.parse(raw, reviveDates) as T) : null;
    } catch {
      // Un cache indisponible ne doit jamais faire tomber une requete :
      // on degrade vers la source, plus lentement mais correctement.
      return null;
    }
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    try {
      await this.client.set(key, JSON.stringify(value), 'EX', ttlSeconds);
    } catch {
      // Idem : echouer a memoriser n'est pas une erreur fonctionnelle.
    }
  }

  async invalidate(pattern: string): Promise<number> {
    let removed = 0;
    // `scan` plutot que `keys` : `keys` bloque Redis sur un gros jeu.
    const stream = this.client.scanStream({ match: pattern, count: 200 });
    for await (const batch of stream as AsyncIterable<string[]>) {
      if (batch.length === 0) continue;
      removed += await this.client.del(...batch);
    }
    return removed;
  }
}

/** Cache memoire : tests et developpement sans Redis. */
export class InMemoryCache implements CachePort {
  private readonly store = new Map<string, { value: unknown; expiresAt: number }>();

  constructor(private readonly now: () => number = () => Date.now()) {}

  async get<T>(key: string): Promise<T | null> {
    const entry = this.store.get(key);
    if (!entry) return null;
    if (entry.expiresAt < this.now()) {
      this.store.delete(key);
      return null;
    }
    return entry.value as T;
  }

  async set<T>(key: string, value: T, ttlSeconds: number): Promise<void> {
    this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
  }

  async invalidate(pattern: string): Promise<number> {
    const regex = new RegExp(`^${pattern.replace(/\*/g, '.*')}$`);
    let removed = 0;
    for (const key of [...this.store.keys()]) {
      if (regex.test(key)) {
        this.store.delete(key);
        removed += 1;
      }
    }
    return removed;
  }
}

export function cacheKey(...parts: readonly (string | number)[]): string {
  return ['dpe', ...parts].join(':');
}

/** Les dates ISO sont restaurees en `Date` : le domaine n'accepte que des Date. */
function reviveDates(_key: string, value: unknown): unknown {
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T[\d:.]+Z$/.test(value)) {
    return new Date(value);
  }
  return value;
}
