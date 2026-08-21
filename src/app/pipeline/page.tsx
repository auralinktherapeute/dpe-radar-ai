import { LEAD_STAGES } from '@domain/crm/Lead.js';
import type { Lead, LeadStage } from '@domain/crm/Lead.js';
import { DEMO_LEADS, DEMO_USERS } from '@interface/server/demo-data';

export const dynamic = 'force-dynamic';

const STAGE_LABEL: Record<LeadStage, string> = {
  A_QUALIFIER: 'A qualifier',
  CONTACTE: 'Contacte',
  RDV_PRIS: 'RDV pris',
  ESTIMATION: 'Estimation',
  MANDAT_SIGNE: 'Mandat signe',
  PERDU: 'Perdu',
};

/**
 * Pipeline de mandat.
 *
 * Le kanban ne montre que les stades ACTIFS par defaut : un negociateur qui
 * voit ses echecs a cote de ses affaires en cours les traite moins bien.
 * Les leads perdus restent accessibles, dans une colonne a part.
 */
export default function PipelinePage() {
  const active = LEAD_STAGES.filter((stage) => stage !== 'PERDU');
  const lost = DEMO_LEADS.filter((lead) => lead.stage === 'PERDU');

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Pipeline</h1>
        <p className="mt-1 text-sm text-muted">
          {DEMO_LEADS.length} leads · {lost.length} clotures
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-5">
        {active.map((stage) => {
          const column = DEMO_LEADS.filter((lead) => lead.stage === stage);
          return (
            <section key={stage} className="flex flex-col gap-2">
              <h2 className="flex items-baseline justify-between font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
                {STAGE_LABEL[stage]}
                <span className="tabular-nums">{column.length}</span>
              </h2>
              <ul className="flex flex-col gap-2">
                {column.map((lead) => (
                  <LeadCard key={lead.id} lead={lead} />
                ))}
              </ul>
            </section>
          );
        })}
      </div>

      <section className="rounded border border-line bg-surface p-4">
        <h2 className="font-mono text-[11px] font-semibold uppercase tracking-wider text-muted">
          Clotures · {lost.length}
        </h2>
        <ul className="mt-3 flex flex-wrap gap-2">
          {lost.map((lead) => (
            <li
              key={lead.id}
              className="rounded border border-line px-3 py-1.5 font-mono text-xs text-muted"
            >
              {DEMO_USERS[lead.ownerId ?? ''] ?? '—'} · {lead.outcome}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function LeadCard({ lead }: { lead: Lead }) {
  return (
    <li className="rounded border border-line bg-surface p-3">
      <p className="font-mono text-xs text-muted">{lead.banId}</p>
      <p className="mt-1.5 flex items-baseline justify-between">
        <span className="text-sm">{DEMO_USERS[lead.ownerId ?? ''] ?? 'Non assigne'}</span>
        <span className="font-mono text-sm font-semibold tabular-nums text-accent">
          {lead.scoreAtEntry ?? '—'}
        </span>
      </p>
    </li>
  );
}
