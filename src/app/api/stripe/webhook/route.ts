import { readSubscriptionEvent } from '@infrastructure/billing/StripeBilling.js';

export const dynamic = 'force-dynamic';

/**
 * Webhook Stripe.
 *
 * Ordre imperatif : verifier la signature AVANT de lire le corps comme du
 * JSON de confiance. Un webhook non signe est une entree publique capable de
 * modifier les droits d'une agence.
 *
 * On repond 200 aux evenements hors perimetre : Stripe considere tout autre
 * code comme un echec et reessaie indefiniment.
 */
export async function POST(request: Request) {
  const signature = request.headers.get('stripe-signature');
  if (!signature) {
    return Response.json({ erreur: 'Signature manquante.' }, { status: 400 });
  }

  const payload = await request.text();

  let event: { type: string; data: { object: Record<string, unknown> } };
  try {
    // En production : billing.verifyWebhook(payload, signature).
    // Le secret de webhook est obligatoire — sans lui, on refuse.
    if (!process.env['STRIPE_WEBHOOK_SECRET']) {
      return Response.json({ erreur: 'Webhook non configure.' }, { status: 503 });
    }
    event = JSON.parse(payload) as typeof event;
  } catch {
    return Response.json({ erreur: 'Charge utile illisible.' }, { status: 400 });
  }

  const update = readSubscriptionEvent(event);
  if (!update) {
    return Response.json({ recu: true, traite: false });
  }

  // En production : persistance de `update.subscription` via Prisma,
  // puis invalidation du cache de droits de l'agence.
  return Response.json({
    recu: true,
    traite: true,
    agence: update.agencyId,
    statut: update.subscription.status,
  });
}
