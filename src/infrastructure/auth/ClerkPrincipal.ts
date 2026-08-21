import type { Principal, Role } from '@domain/tenancy/AccessPolicy.js';

/**
 * Resolution de l'utilisateur courant depuis Clerk.
 *
 * Clerk porte l'identite ; l'appartenance a une agence et le role restent
 * dans NOTRE base. Raison : ce sont des donnees metier qui conditionnent le
 * cloisonnement multi-agences, et les deleguer a un fournisseur externe
 * reviendrait a confier la regle d'acces a un systeme qu'on ne teste pas.
 */
export interface ClerkSession {
  readonly userId: string;
  readonly orgId?: string | undefined;
}

export interface MembershipReader {
  /** Appartenance metier de l'utilisateur, lue dans notre base. */
  findMembership(clerkUserId: string): Promise<{
    readonly agencyId: string;
    readonly networkId: string | null;
    readonly role: Role;
  } | null>;
}

export type PrincipalResolution =
  | { readonly status: 'AUTHENTICATED'; readonly principal: Principal }
  | { readonly status: 'ANONYMOUS' }
  | { readonly status: 'NO_MEMBERSHIP'; readonly clerkUserId: string };

export class ClerkPrincipalResolver {
  constructor(private readonly memberships: MembershipReader) {}

  async resolve(session: ClerkSession | null): Promise<PrincipalResolution> {
    if (!session?.userId) return { status: 'ANONYMOUS' };

    const membership = await this.memberships.findMembership(session.userId);
    // Un compte Clerk valide sans rattachement metier n'est PAS un acces :
    // c'est un utilisateur invite dont l'affectation n'a pas ete faite.
    if (!membership) return { status: 'NO_MEMBERSHIP', clerkUserId: session.userId };

    return {
      status: 'AUTHENTICATED',
      principal: {
        userId: session.userId,
        agencyId: membership.agencyId,
        networkId: membership.networkId,
        role: membership.role,
      },
    };
  }
}

/** Routes accessibles sans session. Tout le reste exige une authentification. */
export const PUBLIC_ROUTES = ['/', '/opposition', '/tarifs', '/api/sante'] as const;

export function isPublicRoute(pathname: string): boolean {
  return PUBLIC_ROUTES.some((route) => pathname === route || pathname.startsWith(`${route}/`));
}
