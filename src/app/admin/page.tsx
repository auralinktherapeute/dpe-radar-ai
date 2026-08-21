import { DEMO_AGENCY, DEMO_FLAGS } from '@interface/server/demo-data';

export const dynamic = 'force-dynamic';

/**
 * Administration d'agence.
 *
 * Le regime du canal telephone est affiche ici en clair, avec ses
 * consequences, plutot que masque derriere un interrupteur anodin. Le choix
 * appartient au responsable de traitement ; le produit se contente de
 * l'exposer et de le journaliser avec chaque approche preparee.
 */
export default function AdminPage() {
  const assume = DEMO_FLAGS.phonePolicyMode === 'AGENCY_RESPONSIBILITY';

  return (
    <div className="flex flex-col gap-8">
      <header>
        <h1 className="font-display text-3xl font-bold tracking-tight">Administration</h1>
        <p className="mt-1 text-sm text-muted">{DEMO_AGENCY.name}</p>
      </header>

      <section className="rounded border border-line bg-surface p-5">
        <h2 className="font-display text-lg font-semibold">Responsable de traitement</h2>
        <dl className="mt-3 grid gap-3 text-sm sm:grid-cols-2">
          <Row label="Raison sociale" value={DEMO_AGENCY.name} />
          <Row label="Adresse postale" value={DEMO_AGENCY.postalAddress} />
          <Row label="Contact DPO" value={DEMO_AGENCY.dpoContact} />
          <Row label="Page d’opposition" value={DEMO_AGENCY.oppositionUrl} />
        </dl>
        <p className="mt-4 text-xs text-muted">
          Ces informations alimentent le bloc d’information obligatoire joint a chaque prise de
          contact. Elles ne sont pas modifiables par un negociateur.
        </p>
      </section>

      <section className="rounded border border-line bg-surface p-5">
        <h2 className="font-display text-lg font-semibold">Canaux de prise de contact</h2>

        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <Channel label="Courrier adresse" state="actif" />
          <Channel label="Boitage non adresse" state="actif" />
          <Channel label="Porte-a-porte" state="actif" />
          <Channel
            label="Telephone"
            state={DEMO_FLAGS.phoneChannelEnabled ? 'actif' : 'inactif'}
          />
          <Channel label="E-mail / SMS" state="sur opt-in uniquement" />
        </ul>

        <div
          className={`mt-4 rounded border px-4 py-3 text-sm ${
            assume ? 'border-dpe-f/40 bg-dpe-f/10' : 'border-line bg-ground'
          }`}
        >
          <p className="font-mono text-[10px] font-semibold uppercase tracking-wider text-dpe-f">
            Regime du canal telephone
          </p>
          <p className="mt-1.5">
            {assume ? (
              <>
                <strong>Responsabilite de l’agence.</strong> Les appels sur interet legitime sont
                autorises. Le regime du 11 aout 2026 exige en principe un consentement prealable
                ou un contrat en cours : chaque appel prepare est horodate et journalise avec la
                base legale revendiquee.
              </>
            ) : (
              <>
                <strong>Consentement requis.</strong> Un appel n’est prepare que sur consentement
                prealable prouve ou contrat en cours.
              </>
            )}
          </p>
          <p className="mt-2 text-xs text-muted">
            Les numeros proviennent exclusivement du logiciel de pige sous licence de l’agence.
            Aucune coordonnee n’est extraite des donnees publiques ADEME ou DVF.
          </p>
        </div>
      </section>

      <section className="rounded border border-line bg-surface p-5">
        <h2 className="font-display text-lg font-semibold">Import de la pige</h2>
        <p className="mt-2 text-sm text-muted">
          DPE Radar AI ne collecte aucune annonce lui-meme. Il importe l’export de votre outil
          (Pige Online, Pericles, MyPige, Directimmo ou CSV generique) et le rapproche du Radar
          par l’identifiant BAN. La reference de votre licence est conservee avec chaque
          coordonnee importee.
        </p>
      </section>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[10px] uppercase tracking-wider text-muted">{label}</dt>
      <dd className="mt-0.5">{value}</dd>
    </div>
  );
}

function Channel({ label, state }: { label: string; state: string }) {
  return (
    <li className="flex items-center justify-between border-b border-line pb-2 last:border-0">
      <span>{label}</span>
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted">{state}</span>
    </li>
  );
}
