import { SCALE_VERSION } from '@domain/scoring/signals/weights.js';

/**
 * Sonde de vie. Ne touche NI la base NI Redis : elle doit distinguer
 * « application morte » de « dependance indisponible ». Une sonde qui tombe
 * parce que Postgres redemarre fait redemarrer l'application pour rien.
 */
export function GET() {
  return Response.json({
    statut: 'ok',
    bareme: SCALE_VERSION,
    horodatage: new Date().toISOString(),
  });
}
