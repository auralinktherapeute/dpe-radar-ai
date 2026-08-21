import { StyleSheet, Text, View } from 'react-native';
import { BAND_COLOR, COLORS, SPACING } from '../theme';
import type { ApiProperty } from '../api';

/**
 * Pastille de score.
 *
 * Meme regle que sur le web, et elle vient du domaine : quand `score` est
 * `null`, on affiche une FOURCHETTE, jamais un chiffre. La contrainte est plus
 * forte encore sur mobile, ou le negociateur lit vite et retient un nombre.
 */
export function ScoreBadge({ bien, band }: { bien: ApiProperty; band: string }) {
  const color = BAND_COLOR[band] ?? BAND_COLOR.INDETERMINE;

  return (
    <View style={styles.wrap}>
      <View style={[styles.badge, { backgroundColor: `${color}22`, borderColor: `${color}66` }]}>
        <Text style={[styles.value, { color }]}>
          {bien.score === null ? `${bien.fourchette.min}–${bien.fourchette.max}` : bien.score}
        </Text>
      </View>
      <Text style={styles.confidence}>conf. {bien.confiance}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { alignItems: 'center', gap: 2 },
  badge: {
    minWidth: 58,
    paddingHorizontal: SPACING.md,
    paddingVertical: SPACING.sm,
    borderRadius: 999,
    borderWidth: 1,
    alignItems: 'center',
  },
  value: { fontSize: 17, fontWeight: '700', fontVariant: ['tabular-nums'] },
  confidence: { fontSize: 11, color: COLORS.muted, fontVariant: ['tabular-nums'] },
});
