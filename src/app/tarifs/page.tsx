import { PLANS, TRIAL_DAYS } from '@domain/billing/Plan.js';
import type { PlanEntitlements } from '@domain/billing/Plan.js';

/**
 * Page tarifs.
 *
 * Les caracteristiques sont lues dans le domaine, pas recopiees ici. Une page
 * de prix qui derive du code est le meilleur moyen de vendre une
 * fonctionnalite qu'on ne livre pas.
 */
export default function TarifsPage() {
  const plans = [PLANS.STARTER, PLANS.PRO, PLANS.RESEAU];

  return (
    <div className="flex flex-col gap-8">
      <header className="max-w-2xl">
        <h1 className="font-display text-3xl font-bold tracking-tight">Offres</h1>
        <p className="mt-2 text-sm text-muted">
          {TRIAL_DAYS} jours d’essai, sans carte bancaire. Le dossier de conformite — analyse
          d’impact pre-remplie et contrat de sous-traitance — est inclus dans toutes les offres.
        </p>
      </header>

      <div className="grid gap-4 md:grid-cols-3">
        {plans.map((plan) => (
          <PlanCard key={plan.id} plan={plan} highlighted={plan.id === 'PRO'} />
        ))}
      </div>

      <section className="rounded border border-dpe-e/40 bg-dpe-e/10 p-5 text-sm">
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-wider text-dpe-f">
          Couverture territoriale
        </h2>
        <p className="mt-2">
          Les départements <strong>57, 67, 68 et 976</strong> ne disposent pas de données DVF :
          l’Alsace-Moselle relève du livre foncier et Mayotte est hors dispositif. Trois signaux
          sur huit y sont indisponibles et la confiance plafonne à 84. Nous le disons avant la
          signature, pas après.
        </p>
      </section>
    </div>
  );
}

function PlanCard({ plan, highlighted }: { plan: PlanEntitlements; highlighted: boolean }) {
  return (
    <section
      className={`flex flex-col gap-4 rounded border bg-surface p-5 ${
        highlighted ? 'border-accent shadow-sm' : 'border-line'
      }`}
    >
      <header>
        <h2 className="font-display text-lg font-semibold">{plan.label}</h2>
        <p className="mt-2 font-mono text-2xl font-semibold tabular-nums">
          {plan.monthlyPriceEur === null ? 'Sur devis' : `${plan.monthlyPriceEur} € / mois`}
        </p>
        {plan.extraSeatPriceEur !== null && (
          <p className="mt-1 text-xs text-muted">
            siège supplémentaire {plan.extraSeatPriceEur} € / mois
          </p>
        )}
      </header>

      <ul className="flex flex-col gap-1.5 text-sm">
        <Item ok label={`${plan.maxTerritories ?? 'Communes illimitées'}${plan.maxTerritories ? ' communes' : ''}`} />
        <Item ok label={plan.includedSeats > 0 ? `${plan.includedSeats} sièges inclus` : 'Sièges par agence'} />
        <Item ok label={plan.monthlyDrafts === null ? 'Copilote illimité' : `${plan.monthlyDrafts} brouillons / mois`} />
        <Item ok={plan.crmConnectors} label="Connecteurs Apimo, Hektor, Netty" />
        <Item ok={plan.openApi} label="API ouverte" />
        <Item ok={plan.networkDashboard} label="Pilotage multi-agences" />
      </ul>
    </section>
  );
}

function Item({ ok, label }: { ok: boolean; label: string }) {
  return (
    <li className={`flex items-baseline gap-2 ${ok ? '' : 'text-muted line-through'}`}>
      <span aria-hidden className="font-mono text-xs text-accent">
        {ok ? '✓' : '·'}
      </span>
      {label}
    </li>
  );
}
