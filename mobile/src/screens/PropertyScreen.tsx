import { Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { bandFor, CONFIDENCE_MIN_FOR_EXACT_SCORE } from '@domain/scoring/entities/OpportunityScore.js';
import { ScoreBadge } from '../components/ScoreBadge';
import { COLORS, MIN_TOUCH, SPACING } from '../theme';
import { channelLabel } from '../api';
import type { ApiProperty } from '../api';

/**
 * Fiche bien — ce que le negociateur lit devant le portail.
 *
 * Chaque raison porte sa source et sa date : c'est ce qui lui permet de citer
 * une information sans se decredibiliser. Et les actions proposees sont
 * exactement celles que la politique de contact autorise cote serveur — le
 * mobile n'ouvre aucun canal de son propre chef.
 */
export function PropertyScreen({ bien, onBack }: { bien: ApiProperty; onBack: () => void }) {
  const band = bien.score === null ? 'INDETERMINE' : bandFor(bien.score);

  return (
    <ScrollView contentContainerStyle={styles.container}>
      <Pressable style={styles.back} onPress={onBack} accessibilityRole="button">
        <Text style={styles.backLabel}>‹ Radar</Text>
      </Pressable>

      <View style={styles.head}>
        <View style={styles.headText}>
          <Text style={styles.address}>{bien.adresse}</Text>
          <Text style={styles.meta}>
            DPE {bien.classe_dpe} · {bien.identifiant_ban}
          </Text>
        </View>
        <ScoreBadge bien={bien} band={band} />
      </View>

      {bien.score === null && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            Confiance sous {CONFIDENCE_MIN_FOR_EXACT_SCORE} : aucun score chiffre n’est affiche.
            La fourchette reste exploitable, le chiffre exact ne le serait pas.
          </Text>
        </View>
      )}

      {bien.comparabilite === 'NO_MARKET_DATA' && (
        <View style={styles.warn}>
          <Text style={styles.warnText}>
            Territoire sans donnees DVF : ce score n’est pas comparable a celui d’une commune
            couverte.
          </Text>
        </View>
      )}

      <Text style={styles.sectionTitle}>Pourquoi ce score</Text>
      <View style={styles.reasons}>
        {bien.raisons.map((raison) => (
          <View key={raison.libelle} style={styles.reason}>
            <Text style={styles.points}>+{raison.points.toFixed(1)}</Text>
            <View style={styles.reasonBody}>
              <Text style={styles.reasonLabel}>{raison.libelle}</Text>
              <Text style={styles.reasonSource}>
                {raison.source} · {formatFrenchDate(raison.date_donnee)}
              </Text>
            </View>
          </View>
        ))}
        {bien.raisons.length === 0 && (
          <Text style={styles.reasonSource}>Aucun signal exploitable sur ce bien.</Text>
        )}
      </View>

      <Text style={styles.sectionTitle}>Approche autorisee</Text>
      <View style={styles.actions}>
        {bien.canaux_autorises.map((canal) => (
          <Pressable
            key={canal}
            style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            onPress={() => handleChannel(canal, bien)}
            accessibilityRole="button"
          >
            <Text style={styles.actionLabel}>{channelLabel(canal)}</Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.footnote}>
        Seuls les canaux autorises par la politique de contact de votre agence sont proposes.
        L’information reglementaire est jointe automatiquement a tout message genere.
      </Text>
    </ScrollView>
  );
}

/**
 * Le mobile n'ouvre le composeur que sur un canal deja autorise cote serveur,
 * et uniquement si un numero existe. Il ne decide de rien.
 */
function handleChannel(canal: string, bien: ApiProperty): void {
  if (canal === 'PHONE') {
    Alert.alert(
      'Appel',
      'Le numero provient de la pige de votre agence. Ouvrez la fiche dans le CRM pour lancer l’appel avec la trame conforme.',
    );
    return;
  }
  if (canal === 'POSTAL_MAIL') {
    Alert.alert(
      'Courrier',
      `Un courrier sera prepare pour ${bien.adresse}, avec le bloc d’information obligatoire.`,
    );
    return;
  }
  if (canal === 'DOOR_TO_DOOR') {
    const query = encodeURIComponent(bien.adresse);
    void Linking.openURL(`https://maps.apple.com/?q=${query}`);
    return;
  }
  Alert.alert('Boitage', 'Ajoute au plan de secteur.');
}

function formatFrenchDate(iso: string): string {
  const [year, month, day] = iso.split('-');
  return day && month && year ? `${day}/${month}/${year}` : iso;
}

const styles = StyleSheet.create({
  container: { padding: SPACING.lg, gap: SPACING.lg, paddingBottom: SPACING.xl * 2 },
  back: { minHeight: MIN_TOUCH, justifyContent: 'center' },
  backLabel: { fontSize: 16, color: COLORS.accent, fontWeight: '600' },
  head: { flexDirection: 'row', alignItems: 'center', gap: SPACING.md },
  headText: { flex: 1, gap: 3 },
  address: { fontSize: 20, fontWeight: '700', color: COLORS.ink },
  meta: { fontSize: 12, color: COLORS.muted },
  warn: {
    padding: SPACING.md,
    borderRadius: 6,
    backgroundColor: '#fbeedd',
    borderWidth: 1,
    borderColor: '#e9ad3c66',
  },
  warnText: { fontSize: 13, color: COLORS.ink, lineHeight: 18 },
  sectionTitle: { fontSize: 16, fontWeight: '700', color: COLORS.ink },
  reasons: {
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  reason: {
    flexDirection: 'row',
    gap: SPACING.md,
    padding: SPACING.lg,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: COLORS.line,
  },
  points: {
    width: 46,
    fontSize: 15,
    fontWeight: '700',
    color: COLORS.accent,
    fontVariant: ['tabular-nums'],
  },
  reasonBody: { flex: 1, gap: 2 },
  reasonLabel: { fontSize: 14, color: COLORS.ink, lineHeight: 19 },
  reasonSource: { fontSize: 11, color: COLORS.muted },
  actions: { flexDirection: 'row', flexWrap: 'wrap', gap: SPACING.sm },
  action: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  actionPressed: { opacity: 0.75 },
  actionLabel: { color: '#fff', fontWeight: '600', fontSize: 15 },
  footnote: { fontSize: 11, color: COLORS.muted, lineHeight: 16 },
});
