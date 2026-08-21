# DPE Radar AI — contexte projet

> Ce fichier prime sur `~/Downloads/CLAUDE.md`, qui decrit **Holisource** et n'a
> aucun rapport avec ce projet.

## Ce que c'est

SaaS de detection precoce d'opportunites de mandat pour agences immobilieres
francaises. Score d'intention de vente 0-100 sur un **bien**, avec indice de
confiance et raisons datees, a partir de donnees publiques (ADEME, DVF, BAN).

## Trois regles a ne pas casser

1. **Le score porte sur un bien, jamais sur une personne.** La cle metier est
   l'identifiant BAN. Aucune coordonnee ne vient des donnees publiques : les
   numeros proviennent uniquement de la pige sous licence de l'agence, et
   chacun porte sa provenance.
2. **`null` n'est pas `0`.** Un signal indisponible est omis du calcul ; un
   signal defavorable vaut zero. Le score porte le fond, la **confiance** porte
   l'incertitude. Sous 40 de confiance, aucun chiffre n'est affiche.
3. **La liste blanche des signaux est un garde-fou de conformite.** Tout ajout
   passe par la revue de `docs/01-conformite-et-cadre-legal.md`. Aucun signal
   socio-demographique, de revenu ou de sante.

## Architecture

Hexagonale, et pour une raison precise : le moteur doit etre **rejouable a
l'identique** — exigence RGPD (expliquer un profilage) et exigence scientifique
(backtester sans fuite temporelle).

```
src/domain/          pur, zero dependance, teste — n'importe rien
src/application/     cas d'usage + ports
src/infrastructure/  adaptateurs (implementent les ports)
src/app/             Next.js 15, App Router
mobile/              Expo, importe src/domain via metro.config.js
```

Regle de dependance : `domain` ← `application` ← `infrastructure`. Aucun type
Prisma, HTTP ou ADEME ne fuit dans une signature de port.

## Etat de la calibration

Bareme **v2.0.0-calibre**, recale sur backtest reel (20/08/2026) :
ville moyenne 2,70x · rural 2,26x · metropole tendue 2,03x.
La these « passoire thermique = vendeur » a ete **refutee** (classe G a 0,69x).
Detail : `docs/07-backtest-resultats.md`.

Toute modification des poids impose d'incrementer `SCALE_VERSION` dans
`src/domain/scoring/signals/weights.ts`.

## Pieges connus

- **`next build` et `next dev` partagent `.next`.** Enchainer les deux donne un
  `ENOENT ... .next/server/app/page.js` trompeur. Le script `predev` detecte et
  nettoie automatiquement ; en cas de doute, `npm run clean`.
- **DVF est publie en retard.** Les fenetres glissantes sont ancrees sur la
  derniere mutation publiee, pas sur la date du jour. Un test de regression
  verrouille ce comportement — ne pas le contourner.
- **Alsace-Moselle et Mayotte (57, 67, 68, 976) n'ont pas de DVF.** Livre
  foncier / hors dispositif. Trois signaux indisponibles, confiance plafonnee.
- Les icones PWA sont **generees** : `python3 scripts/generer-icones.py`.

## Commandes

Voir `DEMARRAGE.md`. L'essentiel :

```bash
npm run dev                                    # http://localhost:3000
npm test                                       # 263 tests
npx tsx scripts/backtest.ts 87085 --diagnostic # rejouer la calibration
```
