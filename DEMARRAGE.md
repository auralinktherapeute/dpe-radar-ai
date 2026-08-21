# Demarrage

Le projet est deja installe : les dependances sont dans `node_modules/` et
`mobile/node_modules/`. Rien a installer pour demarrer.

## 1. Lancer l'application web

```bash
cd ~/Downloads/dpe-radar-ai
npm run dev
```

Puis ouvrir **http://localhost:3000**.

| Ecran | Ce qu'on y voit |
|---|---|
| `/radar` | Le Radar Opportunites, sur **donnees reelles ADEME + DVF** |
| `/radar?commune=67482` | Strasbourg — illustre la degradation controlee hors DVF |
| `/pipeline` | Le pipeline de mandat |
| `/tableau-de-bord` | Indicateurs agence et negociateur |
| `/alertes` | Reglage des alertes |
| `/admin` | Responsable de traitement, canaux, regime telephone |
| `/tarifs` | Offres Starter / Pro / Reseau |

Le premier chargement de `/radar` prend une dizaine de secondes : il interroge
l'ADEME et telecharge les fichiers DVF de la commune. Les suivants sont rapides.

## 2. Rejouer le backtest

C'est le resultat qui decide si le score vaut quelque chose.

```bash
npx tsx scripts/backtest.ts 87085 16015 --diagnostic   # ville moyenne : lift 2,70x
npx tsx scripts/backtest.ts 33063                      # metropole     : lift 2,03x
npx tsx scripts/backtest.ts 24520 24294 24053 24138    # rural         : lift 2,26x
```

`--diagnostic` ventile le pouvoir discriminant signal par signal. Compter
quelques minutes : les fichiers DVF sont telecharges a chaque commune.

## 3. Demonstration en ligne de commande

```bash
npx tsx scripts/demo-scoring.ts 33063   # Bordeaux
npx tsx scripts/demo-scoring.ts 67482   # Strasbourg, hors DVF
```

## 4. Verifier le projet

```bash
npm test          # 263 tests
npm run typecheck # TypeScript strict
npm run build     # build de production
```

## 5. Application mobile

```bash
cd mobile
cp .env.local.example .env.local     # renseigner EXPO_PUBLIC_API_KEY
npm start
```

Pour la faire fonctionner en local, une cle de developpement suffit :
ajouter `DPE_DEV_API_KEY=<une chaine d'au moins 32 caracteres>` dans le
`.env.local` **de la racine**, et la meme valeur dans `mobile/.env.local`
sous `EXPO_PUBLIC_API_KEY`. Cette cle est refusee en production.

## 6. En cas d'erreur `ENOENT ... .next/server/app/page.js`

`next build` et `next dev` ecrivent tous deux dans `.next`. Les enchainer laisse
un dossier hybride, et le message d'erreur ne designe pas la vraie cause.

Le script `predev` detecte le cas et nettoie automatiquement. Si le probleme
persiste :

```bash
npm run clean && npm run dev
```

## 7. Base de donnees et cache (optionnel)

L'application tourne **sans base** : elle lit directement les sources publiques.
Pour la pile complete (PostgreSQL + PostGIS, Redis) :

```bash
docker compose up -d db redis
npx prisma migrate dev
```

## 8. Regenerer les icones PWA

```bash
python3 scripts/generer-icones.py
```

## Ou est quoi

```
src/domain/          coeur metier — pur, sans dependance, teste
  scoring/           signaux, normalisation, score, confiance
  compliance/        politique de contact, information art. 14, trame d'appel
  calibration/       metriques du backtest (AUC, lift, Brier)
  crm/ alerts/ billing/ tenancy/ analytics/
src/application/     cas d'usage + ports de l'architecture hexagonale
src/infrastructure/  adaptateurs ADEME, DVF, BAN, OpenAI, Stripe, Redis, CRM
src/app/             interface Next.js 15 (App Router)
src/interface/       composants et chargement cote serveur
mobile/              application Expo, partage src/domain avec le web
scripts/             backtest et demonstration
docs/                vision, conformite, architecture, scoring, resultats
prisma/schema.prisma schema de donnees
```

## A lire en premier

- `docs/07-backtest-resultats.md` — ce que le modele vaut reellement, et les
  deux priors que la mesure a refutes.
- `docs/01-conformite-et-cadre-legal.md` — les quatre points qui attendent un
  avocat, dont le regime du canal telephone.
- `docs/dossier-de-conception.html` — la synthese, a ouvrir dans un navigateur.
