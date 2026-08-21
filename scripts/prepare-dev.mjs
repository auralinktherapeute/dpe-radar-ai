import { existsSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Empeche le serveur de developpement de demarrer sur un build de production.
 *
 * `next build` et `next dev` ecrivent tous deux dans `.next`. Lancer l'un
 * apres l'autre laisse un dossier hybride, et le symptome est deroutant :
 *   ENOENT ... .next/server/app/page.js
 * alors que le code source est parfaitement valide.
 *
 * `BUILD_ID` n'est ecrit que par `next build`. Sa presence signale donc un
 * build de production, qu'on efface avant de passer en developpement. Dans le
 * cas normal — un `npm run dev` apres un autre — le fichier est absent et le
 * cache de compilation est conserve intact.
 */
const nextDir = resolve(process.cwd(), '.next');

if (existsSync(resolve(nextDir, 'BUILD_ID'))) {
  rmSync(nextDir, { recursive: true, force: true });
  console.log('[prepare-dev] Build de production detecte dans .next — efface avant de demarrer.');
}
