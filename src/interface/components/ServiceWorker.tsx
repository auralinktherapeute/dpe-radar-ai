'use client';

import { useEffect } from 'react';

/**
 * Enregistrement du service worker.
 *
 * Cote client uniquement, et sans bloquer le rendu : l'application doit
 * fonctionner a l'identique si l'enregistrement echoue (navigateur ancien,
 * mode navigation privee, contexte non securise).
 */
export function ServiceWorker() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const timer = window.setTimeout(() => {
      void navigator.serviceWorker.register('/sw.js').catch(() => {
        // Silencieux : l'absence de mode hors-ligne n'est pas une erreur.
      });
    }, 1500);
    return () => window.clearTimeout(timer);
  }, []);

  return null;
}
