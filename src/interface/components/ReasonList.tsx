import type { ScoreReason } from '@domain/scoring/entities/OpportunityScore.js';

const SOURCE_LABEL: Record<string, string> = {
  ADEME: 'ADEME',
  DVF: 'DVF',
  PIGE: 'Annonces',
};

/**
 * Les raisons du score, telles que le negociateur les citera en rendez-vous.
 * La date est affichee systematiquement : citer une donnee sans savoir de
 * quand elle date decredibilise.
 */
export function ReasonList({ reasons }: { reasons: readonly ScoreReason[] }) {
  if (reasons.length === 0) {
    return (
      <p className="text-sm text-muted">
        Aucun signal exploitable sur ce bien. Il n’est pas classe.
      </p>
    );
  }

  return (
    <ol className="divide-y divide-line">
      {reasons.map((reason) => (
        <li key={reason.signalId} className="flex items-baseline gap-4 py-2.5">
          <span className="w-16 shrink-0 font-mono text-sm font-semibold tabular-nums text-accent">
            +{reason.contribution.toFixed(1)}
          </span>
          <span className="flex-1 text-sm">{reason.label}</span>
          <span className="shrink-0 font-mono text-xs text-muted">
            {SOURCE_LABEL[reason.source] ?? reason.source} ·{' '}
            {reason.observedAt.toLocaleDateString('fr-FR')}
          </span>
        </li>
      ))}
    </ol>
  );
}
