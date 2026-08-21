/**
 * Bandeau de couverture territoriale.
 *
 * Affiche explicitement pourquoi un score est degrade. Sans cette explication,
 * un directeur d'agence alsacien conclut que l'outil fonctionne mal — alors
 * que la donnee n'existe pas, pour une raison de droit local.
 */
export function CoverageBanner({ message }: { message: string }) {
  return (
    <div className="rounded border border-dpe-e/40 bg-dpe-e/10 px-4 py-3 text-sm">
      <span className="font-mono text-[11px] font-semibold uppercase tracking-wider text-dpe-f">
        Couverture partielle
      </span>
      <p className="mt-1 text-ink">{message}</p>
    </div>
  );
}
