import Link from 'next/link';
import { ScoreBadge } from '@interface/components/ScoreBadge';
import { CoverageBanner } from '@interface/components/CoverageBanner';
import { loadRadar } from '@interface/server/radar';

export const dynamic = 'force-dynamic';

/**
 * Radar Opportunites — l'ecran que le negociateur ouvre le matin.
 *
 * Il repond a une seule question : ou vais-je aujourd'hui ? D'ou le tri par
 * score, les raisons visibles sans clic, et les canaux autorises affiches
 * directement dans la liste — pour qu'aucun appel ne parte par reflexe.
 */
export default async function RadarPage({
  searchParams,
}: {
  searchParams: Promise<{ commune?: string }>;
}) {
  const { commune = '33063' } = await searchParams;
  const { rows, notice, stats } = await loadRadar(commune);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-col gap-2">
        <h1 className="font-display text-3xl font-bold tracking-tight">Radar Opportunites</h1>
        <p className="text-sm text-muted">
          Commune <span className="font-mono">{commune}</span> · {rows.length} biens classes ·{' '}
          {stats ?? 'donnees de marche indisponibles'}
        </p>
      </header>

      {notice && <CoverageBanner message={notice} />}

      <ol className="flex flex-col gap-3">
        {rows.map((row) => (
          <li
            key={row.banId}
            className="rounded border border-line bg-surface p-4 transition-shadow hover:shadow-sm"
          >
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div className="min-w-0 flex-1">
                <Link
                  href={`/radar/${encodeURIComponent(row.banId)}`}
                  className="font-display text-base font-semibold hover:underline"
                >
                  {row.address}
                </Link>
                <p className="mt-1 font-mono text-xs text-muted">
                  DPE {row.dpeClass} · {row.topReason}
                </p>
                {row.dpeCount > 1 && (
                  <p
                    className="mt-1 font-mono text-xs text-accent"
                    title="Plusieurs diagnostics recents a cette adresse : activite de copropriete."
                  >
                    {row.dpeCount} diagnostics recents a cette adresse
                  </p>
                )}
              </div>
              <ScoreBadge score={row.score} />
            </div>

            <p className="mt-3 font-mono text-[11px] uppercase tracking-wider text-muted">
              Canaux autorises : {row.channels.join(' · ')}
            </p>
          </li>
        ))}
      </ol>

      {rows.length === 0 && (
        <p className="rounded border border-line bg-surface p-6 text-sm text-muted">
          Aucun diagnostic recent sur cette commune. Elargissez la fenetre ou verifiez le
          secteur souscrit.
        </p>
      )}
    </div>
  );
}
