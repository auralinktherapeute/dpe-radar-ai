/**
 * Cloisonnement multi-agences.
 *
 * Une agence ne doit jamais voir les leads, les scores consultes ni les
 * approches d'une autre — y compris a l'interieur d'un meme reseau. Un
 * directeur de reseau voit des AGREGATS, pas des fiches nominatives d'agences
 * concurrentes du meme groupe.
 */
export type Role = 'NEGOCIATEUR' | 'DIRECTEUR' | 'ADMIN_RESEAU';

export interface Principal {
  readonly userId: string;
  readonly agencyId: string;
  readonly networkId: string | null;
  readonly role: Role;
}

export interface AgencyRef {
  readonly agencyId: string;
  readonly networkId: string | null;
}

export type Scope = 'OWN_LEADS' | 'AGENCY' | 'NETWORK_AGGREGATE';

export type AccessDecision =
  | { readonly granted: true; readonly scope: Scope }
  | { readonly granted: false; readonly reason: string };

export class AccessPolicy {
  /** Acces aux donnees nominatives (leads, approches) d'une agence. */
  canReadAgencyData(principal: Principal, target: AgencyRef): AccessDecision {
    if (principal.agencyId === target.agencyId) {
      return {
        granted: true,
        scope: principal.role === 'NEGOCIATEUR' ? 'OWN_LEADS' : 'AGENCY',
      };
    }
    // Meme reseau : les agregats sont permis, le detail ne l'est pas.
    return {
      granted: false,
      reason:
        principal.networkId !== null && principal.networkId === target.networkId
          ? 'Les donnees nominatives d’une autre agence du reseau ne sont pas accessibles ; seuls les agregats le sont.'
          : 'Agence hors perimetre.',
    };
  }

  /** Acces aux indicateurs agreges d'une agence. */
  canReadAggregate(principal: Principal, target: AgencyRef): AccessDecision {
    if (principal.agencyId === target.agencyId) {
      return { granted: true, scope: 'AGENCY' };
    }
    if (
      principal.role === 'ADMIN_RESEAU' &&
      principal.networkId !== null &&
      principal.networkId === target.networkId
    ) {
      return { granted: true, scope: 'NETWORK_AGGREGATE' };
    }
    return { granted: false, reason: 'Agence hors perimetre.' };
  }

  /** Seul un directeur peut reassigner un lead a un autre negociateur. */
  canReassignLead(principal: Principal): boolean {
    return principal.role === 'DIRECTEUR' || principal.role === 'ADMIN_RESEAU';
  }

  /** Le coupe-circuit d'agence n'est pas manipulable par un negociateur. */
  canToggleOutreach(principal: Principal): boolean {
    return principal.role !== 'NEGOCIATEUR';
  }
}
