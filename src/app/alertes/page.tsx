import type { AlertKind } from '@domain/alerts/AlertRule.js';
import { DEMO_RULES } from '@interface/server/demo-data';

export const dynamic = 'force-dynamic';

const KIND_LABEL: Record<AlertKind, string> = {
  NOUVEAU_SCORE_ELEVE: 'Nouvelle opportunite au-dessus du seuil',
  PASSOIRE_DETECTEE: 'Passoire thermique detectee (F ou G)',
  BAISSE_DE_PRIX: 'Baisse de prix sur une annonce suivie',
  SCORE_EN_HAUSSE: 'Score en progression sur un bien deja vu',
};

/**
 * Reglage des alertes.
 *
 * Le plafond quotidien est affiche au meme rang que les seuils, parce qu'il
 * fait autant partie du reglage : une alerte qu'on ne peut pas traiter dans
 * la journee devient du bruit, et un negociateur qui coupe ses alertes ne les
 * rallume jamais.
 */
export default function AlertesPage() {
  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Alertes</h1>
        <p className="mt-1 max-w-2xl text-sm text-muted">
          Une alerte n’est emise que si le score est fiable : sous 40 de confiance, aucune
          notification ne part, quel que soit le reglage.
        </p>
      </header>

      <ul className="flex flex-col gap-3">
        {DEMO_RULES.map((rule) => (
          <li
            key={rule.id}
            className={`rounded border bg-surface p-4 ${
              rule.enabled ? 'border-line' : 'border-line opacity-60'
            }`}
          >
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-sm font-semibold">{KIND_LABEL[rule.kind]}</p>
                <p className="mt-1 font-mono text-xs text-muted">
                  {rule.inseeCodes.length > 0
                    ? `communes ${rule.inseeCodes.join(', ')}`
                    : 'tout le secteur souscrit'}
                </p>
              </div>
              <span
                className={`rounded-full px-3 py-1 font-mono text-[10px] font-semibold uppercase tracking-wider ${
                  rule.enabled ? 'bg-accent/12 text-accent' : 'bg-line text-muted'
                }`}
              >
                {rule.enabled ? 'active' : 'inactive'}
              </span>
            </div>

            <dl className="mt-3 flex flex-wrap gap-6 font-mono text-xs text-muted">
              <Field label="score min" value={String(rule.minScore)} />
              <Field label="confiance min" value={String(rule.minConfidence)} />
              <Field label="plafond / jour" value={String(rule.dailyCap)} />
            </dl>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="uppercase tracking-wider">{label}</dt>
      <dd className="mt-0.5 text-sm font-semibold tabular-nums text-ink">{value}</dd>
    </div>
  );
}
