import { computeAgencyKpis, computeByNegotiator } from '@domain/analytics/AgencyKpis.js';
import type { Rate } from '@domain/analytics/AgencyKpis.js';
import { DEMO_AGENCY, DEMO_LEADS, DEMO_TIMINGS, DEMO_USERS } from '@interface/server/demo-data';

export const dynamic = 'force-dynamic';

/**
 * Tableau de bord d'agence.
 *
 * Regle d'affichage : un taux calcule sur moins de dix leads n'est PAS
 * affiche comme un pourcentage. On montre le ratio brut et on le dit.
 * Un « 100 % de conversion » sur deux dossiers fait prendre de mauvaises
 * decisions de management.
 */
export default function DashboardPage() {
  const kpis = computeAgencyKpis(DEMO_LEADS, DEMO_TIMINGS);
  const rows = computeByNegotiator(DEMO_LEADS);

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Tableau de bord</h1>
        <p className="mt-1 text-sm text-muted">{DEMO_AGENCY.name}</p>
      </header>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Tile label="Mandats signes" value={String(kpis.mandatesSigned)} />
        <RateTile label="Contact → RDV" rate={kpis.contactToRdv} />
        <RateTile label="RDV → mandat" rate={kpis.rdvToMandat} />
        <Tile
          label="Delai median au RDV"
          value={kpis.medianDaysToRdv === null ? '—' : `${kpis.medianDaysToRdv} j`}
        />
      </div>

      <section>
        <h2 className="font-display text-lg font-semibold">Entonnoir</h2>
        <ul className="mt-3 flex flex-col gap-1.5">
          {Object.entries(kpis.funnel.byStage).map(([stage, count]) => (
            <li key={stage} className="flex items-center gap-3">
              <span className="w-32 shrink-0 font-mono text-xs text-muted">{stage}</span>
              <span
                className="h-5 rounded-sm bg-accent/80"
                style={{ width: `${Math.max(count * 22, count ? 10 : 0)}px` }}
              />
              <span className="font-mono text-xs tabular-nums text-muted">{count}</span>
            </li>
          ))}
        </ul>
      </section>

      <section>
        <h2 className="font-display text-lg font-semibold">Par negociateur</h2>
        <div className="mt-3 overflow-x-auto rounded border border-line bg-surface">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-line bg-ground">
                <Th>Negociateur</Th>
                <Th>Leads</Th>
                <Th>Mandats</Th>
                <Th>Conversion</Th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.ownerId} className="border-b border-line last:border-0">
                  <td className="px-4 py-2.5">{DEMO_USERS[row.ownerId] ?? row.ownerId}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums">{row.kpis.funnel.total}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums">{row.kpis.mandatesSigned}</td>
                  <td className="px-4 py-2.5 font-mono tabular-nums text-muted">
                    {formatRate(row.kpis.globalConversion)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Th({ children }: { children: React.ReactNode }) {
  return (
    <th className="px-4 py-2.5 text-left font-mono text-[10px] font-semibold uppercase tracking-wider text-muted">
      {children}
    </th>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-line bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{value}</p>
    </div>
  );
}

function RateTile({ label, rate }: { label: string; rate: Rate }) {
  return (
    <div className="rounded border border-line bg-surface p-4">
      <p className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</p>
      <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">{formatRate(rate)}</p>
      {!rate.reliable && rate.denominator > 0 && (
        <p className="mt-1 text-[11px] text-muted">
          echantillon trop faible ({rate.numerator}/{rate.denominator})
        </p>
      )}
    </div>
  );
}

function formatRate(rate: Rate): string {
  if (rate.value === null) return '—';
  if (!rate.reliable) return `${rate.numerator}/${rate.denominator}`;
  return `${Math.round(rate.value * 100)} %`;
}
