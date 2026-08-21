'use client';

import { useEffect, useRef } from 'react';

/**
 * Carte du secteur.
 *
 * Deux partis pris :
 *  - la couleur du point encode la BANDE de score, pas sa valeur exacte. Sur
 *    une carte, personne ne lit un degrade continu ; on lit quatre niveaux.
 *  - un bien sans score fiable est affiche en gris et non masque. Le cacher
 *    laisserait croire qu'il n'y a rien a cet endroit, ce qui est faux.
 */
export interface MapPoint {
  readonly banId: string;
  readonly latitude: number;
  readonly longitude: number;
  readonly band: string;
  readonly address: string;
  readonly score: number | null;
}

const BAND_COLOR: Record<string, string> = {
  PRIORITAIRE: '#cf2f26',
  ELEVE: '#e07a35',
  MODERE: '#e9ad3c',
  FAIBLE: '#96c751',
  INDETERMINE: '#8b98a5',
};

export function RadarMap({ points, token }: { points: readonly MapPoint[]; token: string | null }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!token || !container.current || points.length === 0) return;

    let cleanup: (() => void) | undefined;

    // Import dynamique : mapbox-gl pese lourd et n'a aucun interet cote
    // serveur. Le Radar reste utilisable si la carte ne charge pas.
    void (async () => {
      const mapboxgl = (await import('mapbox-gl')).default;
      mapboxgl.accessToken = token;

      const first = points[0]!;
      const map = new mapboxgl.Map({
        container: container.current!,
        style: 'mapbox://styles/mapbox/light-v11',
        center: [first.longitude, first.latitude],
        zoom: 12,
      });
      map.addControl(new mapboxgl.NavigationControl(), 'top-right');

      for (const point of points) {
        const element = document.createElement('button');
        element.type = 'button';
        element.setAttribute(
          'aria-label',
          `${point.address}, score ${point.score ?? 'indetermine'}`,
        );
        element.style.cssText = [
          'width:14px;height:14px;border-radius:50%;cursor:pointer;padding:0',
          `background:${BAND_COLOR[point.band] ?? BAND_COLOR.INDETERMINE}`,
          'border:2px solid #fff;box-shadow:0 1px 3px rgba(0,0,0,.35)',
        ].join(';');

        new mapboxgl.Marker({ element })
          .setLngLat([point.longitude, point.latitude])
          .setPopup(
            new mapboxgl.Popup({ offset: 14 }).setHTML(
              `<strong>${escapeHtml(point.address)}</strong><br>score ${point.score ?? '—'}`,
            ),
          )
          .addTo(map);
      }

      cleanup = () => map.remove();
    })();

    return () => cleanup?.();
  }, [points, token]);

  if (!token) {
    return (
      <div className="rounded border border-line bg-surface p-4 text-sm text-muted">
        Carte indisponible : jeton Mapbox non configure.
      </div>
    );
  }

  return (
    <div
      ref={container}
      className="h-80 w-full overflow-hidden rounded border border-line"
      role="region"
      aria-label="Carte des opportunites du secteur"
    />
  );
}

/** Le contenu de la bulle est injecte en HTML : on echappe l'adresse. */
function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
