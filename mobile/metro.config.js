const { getDefaultConfig } = require('expo/metro-config');
const path = require('node:path');
const fs = require('node:fs');

const projectRoot = __dirname;
const workspaceRoot = path.resolve(projectRoot, '..');
const domainRoot = path.resolve(workspaceRoot, 'src/domain');

const config = getDefaultConfig(projectRoot);

/**
 * L'application mobile partage le DOMAINE avec le web.
 *
 * C'est le benefice concret de l'architecture hexagonale : `src/domain` est du
 * TypeScript pur, sans dependance, donc directement consommable par React
 * Native. Les bandes de score, les seuils de confiance et les regles de
 * couverture territoriale sont les MEMES des deux cotes — il n'existe pas deux
 * verites sur ce qu'est un score « eleve ».
 */
config.watchFolders = [domainRoot];
config.resolver.nodeModulesPaths = [
  path.resolve(projectRoot, 'node_modules'),
  path.resolve(workspaceRoot, 'node_modules'),
];

const defaultResolveRequest = config.resolver.resolveRequest;

config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (moduleName.startsWith('@domain/')) {
    const relative = moduleName.slice('@domain/'.length);
    // Le domaine importe avec l'extension `.js` (style ESM/NodeNext), que tsc
    // et vitest resolvent nativement mais pas Metro. On retablit la
    // correspondance ici plutot que de degrader les imports du domaine.
    const candidates = [
      relative.replace(/\.js$/, '.ts'),
      relative.replace(/\.js$/, '.tsx'),
      relative,
      `${relative}.ts`,
      `${relative}/index.ts`,
    ];

    for (const candidate of candidates) {
      const filePath = path.resolve(domainRoot, candidate);
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        return { type: 'sourceFile', filePath };
      }
    }
  }

  return defaultResolveRequest
    ? defaultResolveRequest(context, moduleName, platform)
    : context.resolveRequest(context, moduleName, platform);
};

module.exports = config;
