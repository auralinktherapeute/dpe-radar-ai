import type { DpeClass } from '../scoring/value-objects/DpeClass.js';
import { CONFIDENCE_MIN_FOR_EXACT_SCORE } from '../scoring/entities/OpportunityScore.js';

/**
 * Alertes temps reel.
 *
 * Regle de conception : une alerte doit etre ACTIONNABLE le jour meme. Une
 * notification qu'on ne peut pas traiter dans la journee devient du bruit, et
 * un negociateur qui coupe ses alertes ne les rallume jamais.
 * D'ou le plafond quotidien et la deduplication ci-dessous.
 */
export type AlertKind =
  | 'NOUVEAU_SCORE_ELEVE'
  | 'PASSOIRE_DETECTEE'
  | 'BAISSE_DE_PRIX'
  | 'SCORE_EN_HAUSSE';

export interface AlertRule {
  readonly id: string;
  readonly agencyId: string;
  readonly kind: AlertKind;
  readonly enabled: boolean;
  /** Communes surveillees. Vide = tout le secteur souscrit. */
  readonly inseeCodes: readonly string[];
  readonly minScore: number;
  readonly minConfidence: number;
  /** Plafond quotidien par regle. Au-dela, l'alerte est retenue. */
  readonly dailyCap: number;
}

export interface AlertCandidate {
  readonly banId: string;
  readonly inseeCode: string;
  readonly kind: AlertKind;
  readonly score: number | null;
  readonly confidence: number;
  readonly dpeClass: DpeClass | null;
  readonly scoreDelta: number | null;
  readonly occurredAt: Date;
}

export interface Alert {
  readonly ruleId: string;
  readonly agencyId: string;
  readonly banId: string;
  readonly kind: AlertKind;
  readonly headline: string;
  readonly occurredAt: Date;
}

export type AlertVerdict =
  | { readonly fire: true; readonly alert: Alert }
  | { readonly fire: false; readonly reason: string };

export interface AlertContext {
  /** Alertes deja emises aujourd'hui pour cette regle. */
  readonly firedToday: number;
  /** Le bien a-t-il deja declenche cette regle recemment ? */
  readonly alreadyNotified: boolean;
  /** L'adresse est-elle sur la liste de suppression ? */
  readonly suppressed: boolean;
}

const HEADLINES: Record<AlertKind, (c: AlertCandidate) => string> = {
  NOUVEAU_SCORE_ELEVE: (c) => `Nouvelle opportunite · score ${c.score}`,
  PASSOIRE_DETECTEE: (c) => `Passoire thermique detectee · classe ${c.dpeClass}`,
  BAISSE_DE_PRIX: () => 'Baisse de prix sur une annonce suivie',
  SCORE_EN_HAUSSE: (c) => `Score en hausse de ${c.scoreDelta} points`,
};

export function evaluate(
  rule: AlertRule,
  candidate: AlertCandidate,
  context: AlertContext,
): AlertVerdict {
  if (!rule.enabled) return { fire: false, reason: 'Regle desactivee.' };
  if (rule.kind !== candidate.kind) return { fire: false, reason: 'Type d’evenement different.' };

  // Une opposition prime sur toute preference d'alerte.
  if (context.suppressed) {
    return { fire: false, reason: 'Adresse sur la liste de suppression.' };
  }

  if (rule.inseeCodes.length > 0 && !rule.inseeCodes.includes(candidate.inseeCode)) {
    return { fire: false, reason: 'Commune hors perimetre de la regle.' };
  }

  // Un score non fiable ne doit jamais reveiller quelqu'un.
  if (candidate.confidence < Math.max(rule.minConfidence, CONFIDENCE_MIN_FOR_EXACT_SCORE)) {
    return { fire: false, reason: 'Confiance insuffisante pour alerter.' };
  }

  if (candidate.kind !== 'BAISSE_DE_PRIX') {
    if (candidate.score === null || candidate.score < rule.minScore) {
      return { fire: false, reason: 'Score sous le seuil de la regle.' };
    }
  }

  if (candidate.kind === 'SCORE_EN_HAUSSE' && (candidate.scoreDelta ?? 0) <= 0) {
    return { fire: false, reason: 'Pas de progression du score.' };
  }

  if (context.alreadyNotified) {
    return { fire: false, reason: 'Bien deja signale recemment.' };
  }

  if (context.firedToday >= rule.dailyCap) {
    return {
      fire: false,
      reason: `Plafond quotidien atteint (${rule.dailyCap}). Les alertes suivantes sont retenues pour eviter le bruit.`,
    };
  }

  return {
    fire: true,
    alert: {
      ruleId: rule.id,
      agencyId: rule.agencyId,
      banId: candidate.banId,
      kind: candidate.kind,
      headline: HEADLINES[candidate.kind](candidate),
      occurredAt: candidate.occurredAt,
    },
  };
}
