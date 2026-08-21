import Link from 'next/link';

const LINKS = [
  { href: '/radar', label: 'Radar' },
  { href: '/pipeline', label: 'Pipeline' },
  { href: '/tableau-de-bord', label: 'Tableau de bord' },
  { href: '/alertes', label: 'Alertes' },
  { href: '/admin', label: 'Administration' },
  { href: '/tarifs', label: 'Offres' },
] as const;

export function Nav() {
  return (
    <header className="border-b border-line bg-surface">
      <nav className="mx-auto flex max-w-6xl flex-wrap items-center gap-4 px-4 py-4 sm:gap-8 sm:px-6">
        <Link href="/radar" className="font-display text-lg font-extrabold tracking-tight">
          DPE&nbsp;Radar&nbsp;AI
        </Link>
        <ul className="flex flex-wrap gap-4 text-sm sm:gap-6">
          {LINKS.map((link) => (
            <li key={link.href}>
              <Link href={link.href} className="text-muted transition-colors hover:text-ink">
                {link.label}
              </Link>
            </li>
          ))}
        </ul>
      </nav>
    </header>
  );
}
