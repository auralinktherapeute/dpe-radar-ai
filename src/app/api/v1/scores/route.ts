import { loadRadar } from '@interface/server/radar';
import { authenticateApiKey, rateLimit } from '@interface/server/api-auth';

export const dynamic = 'force-dynamic';

/**
 * En-tetes CORS de l'API ouverte.
 *
 * L'API est consommee depuis des origines tierces — application mobile,
 * connecteurs, outils d'agence. `*` est acceptable ici parce que
 * l'autorisation ne repose PAS sur l'origine mais sur une cle portee en
 * en-tete : aucun cookie, aucune session implicite, donc rien qu'une origine
 * malveillante puisse rejouer a l'insu de l'utilisateur.
 */
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  'Access-Control-Max-Age': '86400',
} as const;

export function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/**
 * API ouverte — GET /api/v1/scores?commune=33063
 *
 * Destinee aux integrations des logiciels d'agence. Deux garde-fous que
 * l'interface web n'a pas besoin d'appliquer explicitement :
 *  - la cle d'API porte l'agence ET son offre : l'API est reservee a Pro et
 *    Reseau ;
 *  - la reponse n'expose AUCUNE coordonnee, meme si l'agence en detient. Une
 *    API qui deverse des numeros est une fuite en puissance.
 */
export async function GET(request: Request) {
  const auth = await authenticateApiKey(request);
  if (!auth.ok) {
    return Response.json({ erreur: auth.reason }, { status: auth.status, headers: CORS_HEADERS });
  }

  const limited = rateLimit(auth.agencyId);
  if (!limited.ok) {
    return Response.json(
      { erreur: 'Quota de requetes depasse.' },
      {
        status: 429,
        headers: { ...CORS_HEADERS, 'Retry-After': String(limited.retryAfterSeconds) },
      },
    );
  }

  const url = new URL(request.url);
  const commune = url.searchParams.get('commune');
  if (!commune || !/^\d{5}$/.test(commune)) {
    return Response.json(
      { erreur: 'Parametre `commune` requis : un code INSEE a cinq chiffres.' },
      { status: 400, headers: CORS_HEADERS },
    );
  }

  const { rows, notice } = await loadRadar(commune);

  return Response.json(
    {
    commune,
    couverture: notice,
    biens: rows.map((row) => ({
      identifiant_ban: row.banId,
      adresse: row.address,
      classe_dpe: row.dpeClass,
      score: row.score.score,
      fourchette: row.score.range,
      confiance: row.score.confidence,
      comparabilite: row.score.comparabilityGroup,
      adressable: row.score.mailable,
      diagnostics_a_l_adresse: row.dpeCount,
      raisons: row.score.reasons.map((reason) => ({
        libelle: reason.label,
        points: reason.contribution,
        source: reason.source,
        date_donnee: reason.observedAt.toISOString().slice(0, 10),
      })),
      canaux_autorises: row.channels,
    })),
    bareme: rows[0]?.score.scaleVersion ?? null,
    },
    { headers: CORS_HEADERS },
  );
}
