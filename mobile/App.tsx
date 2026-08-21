import { useMemo, useState } from 'react';
import { SafeAreaView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { RadarScreen } from './src/screens/RadarScreen';
import { PropertyScreen } from './src/screens/PropertyScreen';
import { RadarClient } from './src/api';
import type { ApiProperty } from './src/api';
import { COLORS, SPACING } from './src/theme';

/**
 * DPE Radar AI — application de terrain.
 *
 * Navigation volontairement minimale : deux vues, une pile d'un niveau. Une
 * bibliotheque de navigation complete apporterait ici plus de dependances que
 * de valeur, et le negociateur ne navigue pas — il consulte, il agit, il
 * revient.
 *
 * La configuration vit dans les variables d'environnement Expo : l'URL de
 * l'API et la cle d'agence. Aucune cle n'est ecrite en dur.
 */
const BASE_URL = process.env['EXPO_PUBLIC_API_URL'] ?? 'http://localhost:3000';
const API_KEY = process.env['EXPO_PUBLIC_API_KEY'] ?? '';
const COMMUNE = process.env['EXPO_PUBLIC_COMMUNE'] ?? '33063';

export default function App() {
  const [selected, setSelected] = useState<ApiProperty | null>(null);
  const client = useMemo(() => new RadarClient(BASE_URL, API_KEY), []);

  return (
    <SafeAreaView style={styles.root}>
      <StatusBar style="dark" />
      {API_KEY === '' ? (
        <View style={styles.setup}>
          <Text style={styles.setupTitle}>Configuration requise</Text>
          <Text style={styles.setupBody}>
            Renseignez EXPO_PUBLIC_API_KEY avec la cle d’API de votre agence.
            L’API ouverte est incluse a partir de l’offre Pro.
          </Text>
        </View>
      ) : selected ? (
        <PropertyScreen bien={selected} onBack={() => setSelected(null)} />
      ) : (
        <RadarScreen client={client} commune={COMMUNE} onSelect={setSelected} />
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: COLORS.ground },
  setup: { flex: 1, justifyContent: 'center', padding: SPACING.xl, gap: SPACING.md },
  setupTitle: { fontSize: 20, fontWeight: '700', color: COLORS.ink },
  setupBody: { fontSize: 14, color: COLORS.muted, lineHeight: 20 },
});
