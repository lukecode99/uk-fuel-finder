import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { FuelCode, LatLon, Station } from '../types';
import { fetchStations } from '../api';
import { geocode, fetchRoute, routeBbox } from '../routing';
import { buildCorridor, CorridorStation } from '../route';
import { formatPrice } from '../format';
import { fuelLabel } from '../fuel';
import { colors, radii } from '../theme';
import PriceAge from '../components/PriceAge';

const SETTINGS_KEY = 'ff:routeSettings';
const DETOUR_CHOICES = [2, 5, 10] as const;

function VerdictBadge({ c }: { c: CorridorStation }) {
  if (c.isBaseline) {
    return (
      <Text style={[styles.badge, styles.badgeBaseline]} testID="badge-baseline">
        ON YOUR ROUTE — baseline
      </Text>
    );
  }
  const v = c.verdict!;
  const net = Math.abs(v.netPounds).toFixed(2);
  return v.worthIt ? (
    <Text style={[styles.badge, styles.badgeGood]} testID="badge-worth">
      Worth it — save £{net} net
    </Text>
  ) : (
    <Text style={[styles.badge, styles.badgeBad]} testID="badge-notworth">
      Not worth the detour — £{net} worse off
    </Text>
  );
}

export default function RouteScreen({
  fuel,
  userLoc,
  onSelect,
}: {
  fuel: FuelCode;
  userLoc: LatLon | null;
  onSelect: (s: Station) => void;
}) {
  const [dest, setDest] = useState('');
  const [maxDetour, setMaxDetour] = useState<number>(5);
  const [fillLitres, setFillLitres] = useState('30');
  const [tankLitres, setTankLitres] = useState('50');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [summary, setSummary] = useState<string | null>(null);
  const [corridor, setCorridor] = useState<CorridorStation[] | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(SETTINGS_KEY)
      .then(raw => {
        if (!raw) return;
        const s = JSON.parse(raw);
        if (s.fillLitres) setFillLitres(String(s.fillLitres));
        if (s.tankLitres) setTankLitres(String(s.tankLitres));
        if (s.maxDetour) setMaxDetour(s.maxDetour);
      })
      .catch(() => {});
  }, []);

  const saveSettings = (fill: string, tank: string, detour: number) => {
    AsyncStorage.setItem(
      SETTINGS_KEY,
      JSON.stringify({ fillLitres: Number(fill) || 30, tankLitres: Number(tank) || 50, maxDetour: detour }),
    ).catch(() => {});
  };

  async function go() {
    if (!dest.trim() || busy) return;
    if (!userLoc) {
      setError('Location is needed for route mode — enable it in Settings.');
      return;
    }
    setBusy(true);
    setError(null);
    setCorridor(null);
    setSummary(null);
    try {
      const g = await geocode(dest);
      if (!g) {
        setError("Couldn't find that place — try a postcode or town name.");
        return;
      }
      const route = await fetchRoute(userLoc, g.point);
      if (!route) {
        setError('No drivable route found.');
        return;
      }
      const stations = await fetchStations(routeBbox(route.polyline, 5));
      const litres = Math.max(1, Number(fillLitres) || 30);
      const c = buildCorridor(stations, route.polyline, fuel, maxDetour, litres);
      setCorridor(c);
      setSummary(
        `${g.label} · ${route.distanceMiles.toFixed(0)} mi, ${Math.round(route.durationMinutes)} min · ` +
          `${c.length} station${c.length === 1 ? '' : 's'} within ${maxDetour} min detour`,
      );
      if (!c.length) setError(`No ${fuelLabel(fuel)} prices within ${maxDetour} min of this route.`);
    } catch {
      setError('Route lookup failed — check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={styles.root}>
      <View style={styles.inputRow}>
        <TextInput
          style={styles.destInput}
          placeholder="Destination — postcode or town"
          placeholderTextColor={colors.textDim}
          value={dest}
          onChangeText={setDest}
          onSubmitEditing={go}
          testID="route-dest"
        />
        <Pressable style={styles.goBtn} onPress={go} disabled={busy} testID="route-go">
          {busy ? <ActivityIndicator color={colors.accentDark} size="small" /> : <Text style={styles.goText}>Go</Text>}
        </Pressable>
      </View>

      <View style={styles.settingsRow}>
        <Text style={styles.settingLabel}>Max detour</Text>
        {DETOUR_CHOICES.map(m => (
          <Pressable
            key={m}
            testID={`detour-${m}`}
            style={[styles.pill, maxDetour === m && styles.pillActive]}
            onPress={() => {
              setMaxDetour(m);
              saveSettings(fillLitres, tankLitres, m);
            }}
          >
            <Text style={[styles.pillText, maxDetour === m && styles.pillTextActive]}>{m} min</Text>
          </Pressable>
        ))}
      </View>

      <View style={styles.settingsRow}>
        <Text style={styles.settingLabel}>Typical fill</Text>
        <TextInput
          style={styles.numInput}
          keyboardType="numeric"
          value={fillLitres}
          onChangeText={t => {
            setFillLitres(t);
            saveSettings(t, tankLitres, maxDetour);
          }}
          testID="fill-litres"
        />
        <Text style={styles.settingUnit}>L</Text>
        <Text style={[styles.settingLabel, { marginLeft: 12 }]}>Tank</Text>
        <TextInput
          style={styles.numInput}
          keyboardType="numeric"
          value={tankLitres}
          onChangeText={t => {
            setTankLitres(t);
            saveSettings(fillLitres, t, maxDetour);
          }}
          testID="tank-litres"
        />
        <Text style={styles.settingUnit}>L</Text>
      </View>

      {summary && <Text style={styles.summary} testID="route-summary">{summary}</Text>}
      {error && <Text style={styles.error}>{error}</Text>}

      <FlatList
        data={corridor ?? []}
        keyExtractor={c => c.station.id}
        renderItem={({ item: c }) => {
          const price = c.station.prices[fuel];
          return (
            <Pressable
              style={[styles.card, c.isBaseline && styles.cardBaseline]}
              onPress={() => onSelect(c.station)}
              testID={`corridor-${c.station.id}`}
            >
              <View style={styles.cardTop}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.brand}>{c.station.brand}</Text>
                  <Text style={styles.address} numberOfLines={1}>
                    {c.station.address} · {c.station.postcode}
                  </Text>
                  <PriceAge iso={c.station.priceUpdatedAt} />
                </View>
                <View style={styles.priceCol}>
                  <Text style={styles.price}>{formatPrice(price)}</Text>
                  <Text style={styles.detour}>
                    {c.isBaseline ? 'on route' : `+${c.detourMinutes.toFixed(1)} min detour`}
                  </Text>
                </View>
              </View>
              <VerdictBadge c={c} />
              {!c.isBaseline && c.verdict && (
                <Text style={styles.maths}>
                  {c.verdict.savingPounds >= 0
                    ? `save £${c.verdict.savingPounds.toFixed(2)} at the pump`
                    : `£${Math.abs(c.verdict.savingPounds).toFixed(2)} dearer at the pump`}
                  {' − £'}{c.verdict.detourFuelPounds.toFixed(2)} detour fuel ={' '}
                  {c.verdict.netPounds >= 0 ? '£' : '−£'}{Math.abs(c.verdict.netPounds).toFixed(2)} net
                </Text>
              )}
            </Pressable>
          );
        }}
        ListEmptyComponent={
          corridor === null && !busy && !error ? (
            <Text style={styles.hint}>
              Enter where you're driving — stations along the way get an honest
              worth-the-detour verdict for your {fuelLabel(fuel)} fill.
            </Text>
          ) : null
        }
        contentContainerStyle={{ paddingBottom: 30 }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  inputRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 14, paddingTop: 4 },
  destInput: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
  },
  goBtn: {
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingHorizontal: 18,
    justifyContent: 'center',
  },
  goText: { color: colors.accentDark, fontWeight: '800' },
  settingsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  settingLabel: { color: colors.textDim, fontSize: 13 },
  settingUnit: { color: colors.textDim, fontSize: 13 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillText: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  pillTextActive: { color: colors.accentDark },
  numInput: {
    backgroundColor: colors.card,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    color: colors.text,
    paddingHorizontal: 8,
    paddingVertical: 4,
    fontSize: 13,
    minWidth: 44,
    textAlign: 'center',
  },
  summary: { color: colors.text, fontSize: 13, paddingHorizontal: 16, paddingTop: 10, fontWeight: '600' },
  error: { color: colors.amber, fontSize: 12, paddingHorizontal: 16, paddingTop: 6 },
  card: {
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginHorizontal: 14,
    marginTop: 8,
    gap: 6,
  },
  cardBaseline: { borderColor: colors.accent },
  cardTop: { flexDirection: 'row', alignItems: 'center' },
  brand: { color: colors.text, fontWeight: '700', fontSize: 15 },
  address: { color: colors.textDim, fontSize: 12 },
  priceCol: { alignItems: 'flex-end', marginLeft: 10 },
  price: { color: colors.text, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] },
  detour: { color: colors.textDim, fontSize: 11 },
  badge: { fontSize: 12, fontWeight: '800' },
  badgeBaseline: { color: colors.accent },
  badgeGood: { color: colors.cheap },
  badgeBad: { color: colors.dear },
  maths: { color: colors.textDim, fontSize: 11 },
  hint: { color: colors.textDim, textAlign: 'center', marginTop: 40, paddingHorizontal: 40, lineHeight: 20 },
});
