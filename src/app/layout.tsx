import type { ReactNode } from 'react';
import './globals.css';
import { Nav } from '@interface/components/Nav';
import { ServiceWorker } from '@interface/components/ServiceWorker';

export const metadata = {
  title: 'DPE Radar AI',
  description:
    'Score d’intention de vente sur donnees publiques, explique et conforme.',
  manifest: '/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'DPE Radar', statusBarStyle: 'default' as const },
};

export const viewport = {
  themeColor: '#0f5e5c',
  width: 'device-width',
  initialScale: 1,
  // Usage terrain : le negociateur doit pouvoir zoomer sur une adresse.
  maximumScale: 5,
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="fr">
      <body className="min-h-screen antialiased">
        <Nav />
        <main className="mx-auto max-w-6xl px-4 py-6 sm:px-6 sm:py-8">{children}</main>
        <ServiceWorker />
      </body>
    </html>
  );
}
