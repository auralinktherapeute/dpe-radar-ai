import { evaluate } from '@domain/alerts/AlertRule.js';
import type { AlertCandidate } from '@domain/alerts/AlertRule.js';
import type {
  AlertRuleRepository,
  AlertSink,
  Clock,
  SuppressionListPort,
} from '../ports/index.js';

export interface EvaluateAlertsResult {
  readonly published: number;
  readonly withheld: number;
  readonly reasons: readonly string[];
}

/**
 * Alertes temps reel.
 *
 * Le comptage des alertes retenues est expose, pas seulement celui des alertes
 * emises : si une agence est en permanence au plafond, c'est que ses seuils
 * sont mal regles, et le produit doit pouvoir le lui dire.
 */
export class EvaluateAlerts {
  constructor(
    private readonly rules: AlertRuleRepository,
    private readonly sink: AlertSink,
    private readonly suppression: SuppressionListPort,
    private readonly clock: Clock,
  ) {}

  async execute(
    agencyId: string,
    candidates: readonly AlertCandidate[],
  ): Promise<EvaluateAlertsResult> {
    const rules = await this.rules.listByAgency(agencyId);
    const today = this.clock.now();

    let published = 0;
    let withheld = 0;
    const reasons: string[] = [];
    // Compteur local : plusieurs candidats sont evalues dans le meme passage,
    // le plafond doit tenir compte des alertes emises a l'instant.
    const firedInThisRun = new Map<string, number>();

    for (const candidate of candidates) {
      const suppressed = await this.suppression.isSuppressed({
        banId: candidate.banId,
        inseeCode: candidate.inseeCode,
      });

      for (const rule of rules) {
        const persisted = await this.rules.firedTodayCount(rule.id, today);
        const verdict = evaluate(rule, candidate, {
          firedToday: persisted + (firedInThisRun.get(rule.id) ?? 0),
          alreadyNotified: await this.rules.wasNotified(rule.id, candidate.banId),
          suppressed,
        });

        if (verdict.fire) {
          await this.sink.publish(verdict.alert);
          firedInThisRun.set(rule.id, (firedInThisRun.get(rule.id) ?? 0) + 1);
          published += 1;
        } else {
          withheld += 1;
          if (!reasons.includes(verdict.reason)) reasons.push(verdict.reason);
        }
      }
    }

    return { published, withheld, reasons };
  }
}
