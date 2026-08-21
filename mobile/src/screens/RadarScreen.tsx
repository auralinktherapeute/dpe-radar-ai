import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { bandFor } from '@domain/scoring/entities/OpportunityScore.js';
import { ScoreBadge } from '../components/ScoreBadge';
import { COLORS, MIN_TOUCH, SPACING } from '../theme';
import { channelLabel, formatAge } from '../api';
import type { ApiProperty, CachedRadar, RadarClient } from '../api';

/**
 * Radar Opportunites — l'ecran du matin, en mobilite.
 *
 * Il repond a une seule question, posee dans une voiture : ou vais-je
 * maintenant ? D'ou le tri par score, les canaux autorises visibles sans
 * ouvrir la fiche, et l'age de la donnee affiche en permanence.
 */
export function RadarScreen({
  client,
  commune,
  onSelect,
}: {
  client: RadarClient;
  commune: string;
  onSelect: (bien: ApiProperty) => void;
}) {
  const [data, setData] = useState<CachedRadar | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setError(null);
    try {
      setData(await client.radar(commune));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Erreur inattendue.');
    } finally {
      setLoading(false);
    }
  }, [client, commune]);

  useEffect(() => {
    void load();
  }, [load]);

  if (loading && !data) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color={COLORS.accent} />
      </View>
    );
  }

  if (error && !data) {
    return (
      <View style={styles.center}>
        <Text style={styles.errorTitle}>Radar indisponible</Text>
        <Text style={styles.errorBody}>{error}</Text>
        <Pressable style={styles.retry} onPress={() => void load()}>
          <Text style={styles.retryLabel}>Reessayer</Text>
        </Pressable>
      </View>
    );
  }

  const payload = data?.payload;

  return (
    <FlatList
      data={payload?.biens ?? []}
      keyExtractor={(bien) => bien.identifiant_ban}
      contentContainerStyle={styles.list}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} tintColor={COLORS.accent} />
      }
      ListHeaderComponent={
        <View style={styles.header}>
          <Text style={styles.title}>Radar</Text>
          <Text style={styles.subtitle}>
            {payload?.biens.length ?? 0} biens · commune {commune}
          </Text>
          {data && (
            <Text style={[styles.freshness, data.fromCache && styles.stale]}>
              {data.fromCache ? 'Hors ligne · donnees ' : 'Donnees '}
              {formatAge(data.fetchedAt)}
            </Text>
          )}
          {payload?.couverture && (
            <View style={styles.notice}>
              <Text style={styles.noticeText}>{payload.couverture}</Text>
            </View>
          )}
        </View>
      }
      renderItem={({ item }) => <PropertyRow bien={item} onPress={() => onSelect(item)} />}
    />
  );
}

function PropertyRow({ bien, onPress }: { bien: ApiProperty; onPress: () => void }) {
  const band = bien.score === null ? 'INDETERMINE' : bandFor(bien.score);

  return (
    <Pressable
      style={({ pressed }) => [styles.card, pressed && styles.cardPressed]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${bien.adresse}, score ${bien.score ?? 'indetermine'}`}
    >
      <View style={styles.cardMain}>
        <Text style={styles.address} numberOfLines={2}>
          {bien.adresse}
        </Text>
        <Text style={styles.meta}>
          DPE {bien.classe_dpe}
          {bien.diagnostics_a_l_adresse > 1
            ? ` · ${bien.diagnostics_a_l_adresse} diagnostics a cette adresse`
            : ''}
        </Text>
        <Text style={styles.channels}>
          {bien.canaux_autorises.map(channelLabel).join(' · ')}
        </Text>
      </View>
      <ScoreBadge bien={bien} band={band} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  list: { padding: SPACING.lg, gap: SPACING.md, paddingBottom: SPACING.xl * 2 },
  header: { gap: SPACING.xs, marginBottom: SPACING.sm },
  title: { fontSize: 28, fontWeight: '800', color: COLORS.ink, letterSpacing: -0.5 },
  subtitle: { fontSize: 13, color: COLORS.muted },
  freshness: { fontSize: 12, color: COLORS.accent, marginTop: 2 },
  stale: { color: COLORS.dpeF, fontWeight: '600' },
  notice: {
    marginTop: SPACING.md,
    padding: SPACING.md,
    borderRadius: 6,
    backgroundColor: '#fbeedd',
    borderWidth: 1,
    borderColor: '#e9ad3c66',
  },
  noticeText: { fontSize: 12, color: COLORS.ink, lineHeight: 17 },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.md,
    minHeight: MIN_TOUCH + 24,
    padding: SPACING.lg,
    backgroundColor: COLORS.surface,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: COLORS.line,
  },
  cardPressed: { backgroundColor: COLORS.accentSoft },
  cardMain: { flex: 1, gap: 3 },
  address: { fontSize: 15, fontWeight: '600', color: COLORS.ink },
  meta: { fontSize: 12, color: COLORS.muted },
  channels: { fontSize: 11, color: COLORS.accent, marginTop: 2 },
  errorTitle: { fontSize: 17, fontWeight: '700', color: COLORS.ink },
  errorBody: { fontSize: 14, color: COLORS.muted, textAlign: 'center' },
  retry: {
    minHeight: MIN_TOUCH,
    justifyContent: 'center',
    paddingHorizontal: SPACING.xl,
    borderRadius: 999,
    backgroundColor: COLORS.accent,
  },
  retryLabel: { color: '#fff', fontWeight: '600', fontSize: 15 },
});
