/**
 * Palette partagee avec le web : elle derive de l'etiquette DPE officielle.
 * Un negociateur qui passe du bureau au terrain doit retrouver les memes
 * couleurs pour les memes niveaux — sinon il reapprend l'outil a chaque fois.
 */
export const COLORS = {
  ground: '#f6f7f9',
  surface: '#ffffff',
  ink: '#12161c',
  muted: '#5d6874',
  line: '#dde2e8',
  accent: '#0f5e5c',
  accentSoft: '#e2efee',
  dpeA: '#319a69',
  dpeC: '#96c751',
  dpeE: '#e9ad3c',
  dpeF: '#e07a35',
  dpeG: '#cf2f26',
} as const;

export const BAND_COLOR: Record<string, string> = {
  PRIORITAIRE: COLORS.dpeG,
  ELEVE: COLORS.dpeF,
  MODERE: COLORS.dpeE,
  FAIBLE: COLORS.dpeC,
  INDETERMINE: COLORS.muted,
};

export const SPACING = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24 } as const;

/**
 * Cible tactile minimale recommandee. Un negociateur consulte l'application
 * debout devant un portail, souvent d'une main : les petits boutons sont
 * inutilisables dans ces conditions.
 */
export const MIN_TOUCH = 48;
