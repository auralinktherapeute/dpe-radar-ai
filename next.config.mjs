/** @type {import('next').NextConfig} */
const nextConfig = {
  webpack(config) {
    // Le code metier importe avec l'extension `.js` (style ESM/NodeNext), ce
    // que tsc et vitest resolvent nativement mais pas webpack. On lui apprend
    // la correspondance plutot que de degrader les imports du domaine.
    config.resolve.extensionAlias = {
      ...config.resolve.extensionAlias,
      '.js': ['.ts', '.tsx', '.js'],
    };
    return config;
  },
};
export default nextConfig;
