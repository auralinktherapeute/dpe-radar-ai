import type { OpportunityScore } from '@domain/scoring/entities/OpportunityScore.js';

const BAND_STYLE: Record<string, string> = {
  PRIORITAIRE: 'bg-dpe-g/12 text-dpe-g ring-dpe-g/30',
  ELEVE: 'bg-dpe-f/12 text-dpe-f ring-dpe-f/30',
  MODERE: 'bg-dpe-e/14 text-dpe-e ring-dpe-e/30',
  FAIBLE: 'bg-dpe-c/16 text-dpe-a ring-dpe-a/25',
  INDETERMINE: 'bg-line/60 text-muted ring-line',
};

/**
 * Affichage du score.
 *
 * Regle non negociable, imposee par le domaine et rappelee ici : quand
 * `score` est `null`, on n'affiche PAS de chiffre. Une fourchette honnete
 * vaut mieux qu'un nombre que l'on ne sait pas justifier en rendez-vous.
 */
export function ScoreBadge({ score }: { score: OpportunityScore }) {
  const style = BAND_STYLE[score.band] ?? BAND_STYLE.INDETERMINE;

  return (
    <div className="flex items-center gap-3">
      <span
        className={`inline-flex min-w-16 items-baseline justify-center gap-1 rounded-full px-3 py-1 font-mono text-sm font-semibold tabular-nums ring-1 ${style}`}
      >
        {score.score === null ? (
          <span title="Donnees insuffisantes pour un score chiffre">
            {score.range.min}–{score.range.max}
          </span>
        ) : (
          score.score
        )}
      </span>
      <span className="font-mono text-xs text-muted">
        confiance {score.confidence}
        {score.comparabilityGroup === 'NO_MARKET_DATA' && (
          <span
            className="ml-2 rounded bg-line/70 px-1.5 py-0.5"
            title="Sans donnees DVF : score non comparable avec un territoire couvert."
          >
            hors DVF
          </span>
        )}
      </span>
    </div>
  );
}
