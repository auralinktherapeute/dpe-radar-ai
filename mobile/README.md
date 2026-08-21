# DPE Radar AI — application mobile

Application de terrain (Expo / React Native), destinee au negociateur entre
deux rendez-vous.

## Ce qu'elle partage avec le web

L'application importe directement `src/domain` du depot principal. C'est le
benefice concret de l'architecture hexagonale : le domaine est du TypeScript
pur, sans dependance, donc consommable tel quel par React Native.

Consequence : les **bandes de score**, les **seuils de confiance** et les
regles de **couverture territoriale** sont identiques des deux cotes. Il
n'existe pas deux definitions de ce qu'est un score « eleve ».

La resolution est faite dans `metro.config.js`, qui traduit les imports
`@domain/x.js` (style ESM) vers les fichiers `.ts` reels.

## Ce qu'elle ne partage pas

Elle ne parle **pas** a la base de donnees : elle consomme l'API ouverte v1,
la meme que les connecteurs des logiciels d'agence. Une seule surface a
securiser, un seul contrat a faire evoluer.

## Configuration

```bash
cp .env.local.example .env.local   # puis renseigner la cle d'agence
npm start
```

| Variable | Role |
|---|---|
| `EXPO_PUBLIC_API_URL` | URL de l'instance DPE Radar AI |
| `EXPO_PUBLIC_API_KEY` | Cle d'API de l'agence (offre Pro ou Reseau) |
| `EXPO_PUBLIC_COMMUNE` | Code INSEE affiche par defaut |

## Partis pris

- **Hors ligne assume, jamais masque.** En perte de reseau, le dernier
  resultat connu est affiche avec la mention « Hors ligne · donnees il y a
  N h ». Presenter des donnees d'hier comme fraiches ferait citer une
  information perimee en clientele.
- **Une erreur d'authentification ou de quota remonte.** Elle ne se resout pas
  en montrant des donnees anciennes.
- **Cibles tactiles de 48 pt minimum.** On consulte l'application debout devant
  un portail, souvent d'une main.
- **Aucun canal ouvert de sa propre initiative.** Les actions proposees sont
  exactement celles que la politique de contact autorise cote serveur.
