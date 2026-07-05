import React, { useEffect, useState } from 'react';
import { ActivityIndicator, FlatList, StyleSheet, Text, View } from 'react-native';
import { LatLon } from '../types';
import { Chargepoint, connectorSummary, fetchChargepoints, maxKw } from '../ev';
import { formatDistance } from '../format';
import { haversineMiles } from '../geo';
import { colors, radii } from '../theme';

// Same fallback as MainScreen: usable without a location grant.
const FALLBACK: LatLon = { lat: 51.5074, lon: -0.1278 };
const EV_RADIUS_MILES = 5;

export default function EvScreen({ userLoc }: { userLoc: LatLon | null }) {
  const [points, setPoints] = useState<Chargepoint[] | null>(null);
  const [error, setError] = useState(false);
  const center = userLoc ?? FALLBACK;

  useEffect(() => {
    let live = true;
    setPoints(null);
    setError(false);
    fetchChargepoints(center, EV_RADIUS_MILES)
      .then(cps => {
        if (!live) return;
        const sorted = [...cps].sort(
          (a, b) => haversineMiles(center, a) - haversineMiles(center, b),
        );
        setPoints(sorted);
      })
      .catch(() => live && setError(true));
    return () => {
      live = false;
    };
  }, [center.lat, center.lon]);

  return (
    <View style={styles.root} testID="ev-screen">
      <View style={styles.teaser} testID="ev-teaser">
        <Text style={styles.teaserTitle}>EV charging — early preview</Text>
        <Text style={styles.teaserBody}>
          Chargepoint locations, connectors and power from Open Charge Map’s open data.
          Charging prices are coming later.
        </Text>
      </View>
      {error ? (
        <Text style={styles.note} testID="ev-error">
          Couldn’t load chargepoints — try again in a minute.
        </Text>
      ) : points === null ? (
        <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={points}
          keyExtractor={c => c.id}
          renderItem={({ item }) => <ChargeRow point={item} from={center} />}
          ListEmptyComponent={
            <Text style={styles.note} testID="ev-empty">
              No registered chargepoints within {EV_RADIUS_MILES} mi.
            </Text>
          }
          contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 }}
        />
      )}
    </View>
  );
}

function ChargeRow({ point, from }: { point: Chargepoint; from: LatLon }) {
  const kw = maxKw(point.connectors);
  const inService = point.operational !== false;
  return (
    <View style={styles.row} testID="ev-row">
      <View style={{ flex: 1 }}>
        <Text style={styles.name} numberOfLines={1}>
          {point.name}
        </Text>
        <Text style={styles.meta} numberOfLines={1}>
          {formatDistance(haversineMiles(from, point))}
          {point.postcode ? ` · ${point.postcode}` : ''}
          {point.network ? ` · ${point.network}` : ''}
        </Text>
        <Text style={styles.connectors} numberOfLines={1}>
          {point.connectors.length ? connectorSummary(point.connectors) : 'Connector details unavailable'}
          {!inService ? '  ·  out of service' : ''}
        </Text>
      </View>
      {kw != null && (
        <View style={styles.kwBadge}>
          <Text style={styles.kwText}>{kw % 1 ? kw.toFixed(1) : kw}kW</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  teaser: {
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.accent,
    gap: 3,
  },
  teaserTitle: { color: colors.accent, fontSize: 12, fontWeight: '800', letterSpacing: 0.3 },
  teaserBody: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  note: { color: colors.textDim, textAlign: 'center', marginTop: 40, paddingHorizontal: 30 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginTop: 8,
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  name: { color: colors.text, fontSize: 14, fontWeight: '600' },
  meta: { color: colors.textDim, fontSize: 11, marginTop: 1 },
  connectors: { color: colors.textDim, fontSize: 11, marginTop: 3 },
  kwBadge: {
    backgroundColor: colors.accentDark,
    borderRadius: radii.pill,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  kwText: { color: colors.accent, fontWeight: '800', fontSize: 12 },
});
