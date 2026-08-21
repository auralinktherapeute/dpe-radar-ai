// src/server/api/trpc.ts
/**
 * Configuration tRPC pour DPE Radar AI
 * - Contexte avec auth Clerk + Prisma
 * - Middlewares : authentification, audit, RBAC, rate limiting
 */

import { initTRPC, TRPCError } from '@trpc/server';
import { type CreateNextContextOptions } from '@trpc/server/adapters/next';
import superjson from 'superjson';
import { ZodError } from 'zod';
import { PrismaClient } from '@prisma/client';
import { clerkClient, getAuth } from '@clerk/nextjs/server';
import { Ratelimit } from '@upstash/ratelimit';
import { Redis } from '@upstash/redis';

// ─── Singleton Prisma ─────────────────────────────────────────
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient };
export const prisma = globalForPrisma.prisma ?? new PrismaClient({
  log: process.env.NODE_ENV === 'development' ? ['query', 'error', 'warn'] : ['error'],
});
if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = prisma;

// ─── Rate Limiting (Redis) ────────────────────────────────────
const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

const ratelimit = new Ratelimit({
  redis,
  limiter: Ratelimit.slidingWindow(100, '1 m'), // 100 req/min par user
  analytics: true,
});

// ─── Context ──────────────────────────────────────────────────
interface CreateContextOptions {
  session: {
    userId: string;
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    agencyId: string;
  } | null;
}

export async function createContextInner(opts: CreateContextOptions) {
  return {
    session: opts.session,
    prisma,
  };
}

export async function createTRPCContext(opts: CreateNextContextOptions) {
  const auth = getAuth(opts.req);

  if (!auth?.userId) {
    return createContextInner({ session: null });
  }

  // Récupérer l'utilisateur depuis Clerk + notre DB
  const clerkUser = await clerkClient.users.getUser(auth.userId);
  const dbUser = await prisma.user.findUnique({
    where: { clerkId: auth.userId },
    include: { agency: true },
  });

  if (!dbUser) {
    return createContextInner({ session: null });
  }

  return createContextInner({
    session: {
      userId: dbUser.id,
      email: clerkUser.emailAddresses[0]?.emailAddress ?? '',
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      role: dbUser.role,
      agencyId: dbUser.agencyId,
    },
  });
}

// ─── tRPC Initialization ──────────────────────────────────────
const t = initTRPC.context<typeof createTRPCContext>().create({
  transformer: superjson,
  errorFormatter({ shape, error }) {
    return {
      ...shape,
      data: {
        ...shape.data,
        zodError: error.cause instanceof ZodError ? error.cause.flatten() : null,
      },
    };
  },
});

export const createTRPCRouter = t.router;
export const publicProcedure = t.procedure;

// ─── Middlewares ──────────────────────────────────────────────

/**
 * Middleware d'authentification
 * Vérifie que l'utilisateur est connecté
 */
const enforceAuth = t.middleware(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Non authentifié' });
  }
  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
    },
  });
});

/**
 * Middleware de rate limiting
 * 100 req/min par user
 */
const rateLimit = t.middleware(async ({ ctx, path, next }) => {
  if (!ctx.session) return next({ ctx });

  const { success } = await ratelimit.limit(`${ctx.session.userId}:${path}`);
  if (!success) {
    throw new TRPCError({ code: 'TOO_MANY_REQUESTS', message: 'Trop de requêtes. Réessayez dans une minute.' });
  }
  return next({ ctx });
});

/**
 * Middleware RBAC
 * Vérifie que le rôle de l'utilisateur est dans la liste autorisée
 */
const requireRole = (allowedRoles: string[]) =>
  t.middleware(async ({ ctx, next }) => {
    if (!ctx.session) {
      throw new TRPCError({ code: 'UNAUTHORIZED', message: 'Non authentifié' });
    }
    if (!allowedRoles.includes(ctx.session.role)) {
      throw new TRPCError({
        code: 'FORBIDDEN',
        message: `Accès réservé aux rôles : ${allowedRoles.join(', ')}`,
      });
    }
    return next({ ctx });
  });

/**
 * Middleware d'audit
 * Journalise chaque appel d'API avec les métadonnées
 */
const audit = (action: string, entityType: string) =>
  t.middleware(async ({ ctx, path, input, next }) => {
    const result = await next({ ctx });

    if (ctx.session) {
      // Fire-and-forget audit log
      prisma.auditLog.create({
        data: {
          agencyId: ctx.session.agencyId,
          action: action as any,
          entityType,
          entityId: (input as any)?.id ?? (input as any)?.propertyId ?? 'N/A',
          performedBy: ctx.session.userId,
          metadata: { path, input: sanitizeInput(input) },
        },
      }).catch(() => {}); // Ne pas bloquer en cas d'erreur d'audit
    }

    return result;
  });

function sanitizeInput(input: unknown): unknown {
  if (!input || typeof input !== 'object') return input;
  const sanitized = { ...input as Record<string, unknown> };
  delete sanitized.password;
  delete sanitized.token;
  delete sanitized.apiKey;
  return sanitized;
}

// ─── Procédures protégées ─────────────────────────────────────

export const protectedProcedure = t.procedure
  .use(enforceAuth)
  .use(rateLimit);

export const adminProcedure = t.procedure
  .use(enforceAuth)
  .use(rateLimit)
  .use(requireRole(['ADMIN']));

export const managerProcedure = t.procedure
  .use(enforceAuth)
  .use(rateLimit)
  .use(requireRole(['ADMIN', 'MANAGER']));

export const negotiatorProcedure = t.procedure
  .use(enforceAuth)
  .use(rateLimit)
  .use(requireRole(['ADMIN', 'MANAGER', 'NEGOTIATOR']));
