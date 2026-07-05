import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Location from 'expo-location';
import { FuelCode, LatLon, MapRegion, SortMode, Station } from '../types';
import { fetchStations, loadCachedStations } from '../api';
import { bboxAround } from '../geo';
import { cheapestNear, sortStations } from '../sort';
import { formatPrice } from '../format';
import { fuelLabel } from '../fuel';
import { colors, radii } from '../theme';
import FuelToggle from '../components/FuelToggle';
import StationListItem from '../components/StationListItem';
import StationSheet from '../components/StationSheet';
import StationMap from '../components/StationMap';
import PriceAge from '../components/PriceAge';
import RouteScreen from './RouteScreen';

// Central London fallback when location permission is declined — the app
// stays fully usable, never blocks, never asks for an account.
const FALLBACK: LatLon = { lat: 51.5074, lon: -0.1278 };
const NEARBY_RADIUS_MILES = 5;
const FUEL_KEY = 'ff:fuel';

export default function MainScreen() {
  const [fuel, setFuel] = useState<FuelCode>('E10');
  const [view, setView] = useState<'map' | 'list' | 'route'>('map');
  const [sortMode, setSortMode] = useState<SortMode>('price');
  const [stations, setStations] = useState<Station[]>([]);
  const [userLoc, setUserLoc] = useState<LatLon | null>(null);
  const [selected, setSelected] = useState<Station | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const regionRef = useRef<MapRegion>({
    latitude: FALLBACK.lat,
    longitude: FALLBACK.lon,
    latitudeDelta: 0.25,
    longitudeDelta: 0.25,
  });
  const fetchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadArea = useCallback(async (center: LatLon, radiusMiles: number) => {
    try {
      setError(null);
      const fresh = await fetchStations(bboxAround(center, radiusMiles));
      // Merge by id so panning accumulates coverage instead of dropping
      // stations just off-screen.
      setStations(prev => {
        const byId = new Map(prev.map(s => [s.id, s]));
        for (const s of fresh) byId.set(s.id, s);
        return [...byId.values()];
      });
    } catch {
      setError('Could not reach the price service — showing last known prices.');
    } finally {
      setLoading(false);
    }
  }, []);

  // Launch: cached stations paint immediately; location + live fetch follow.
  useEffect(() => {
    (async () => {
      const [cached, savedFuel] = await Promise.all([
        loadCachedStations(),
        AsyncStorage.getItem(FUEL_KEY),
      ]);
      if (cached.length) {
        setStations(cached);
        setLoading(false);
      }
      if (savedFuel === 'E10' || savedFuel === 'E5' || savedFuel === 'B7' || savedFuel === 'SDV') {
        setFuel(savedFuel);
      }

      let center = FALLBACK;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const pos = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.Balanced,
          });
          center = { lat: pos.coords.latitude, lon: pos.coords.longitude };
          setUserLoc(center);
        }
      } catch {
        // no location — fallback center, app carries on
      }
      regionRef.current = { ...regionRef.current, latitude: center.lat, longitude: center.lon };
      loadArea(center, 10);
    })();
  }, [loadArea]);

  const changeFuel = (f: FuelCode) => {
    setFuel(f);
    AsyncStorage.setItem(FUEL_KEY, f).catch(() => {});
  };

  const onRegionChange = (r: MapRegion) => {
    regionRef.current = r;
    if (fetchTimer.current) clearTimeout(fetchTimer.current);
    fetchTimer.current = setTimeout(() => {
      const radius = Math.max(3, Math.min(40, r.latitudeDelta * 69));
      loadArea({ lat: r.latitude, lon: r.longitude }, radius);
    }, 600);
  };

  const sorted = useMemo(
    () => sortStations(stations, fuel, sortMode, userLoc),
    [stations, fuel, sortMode, userLoc],
  );
  const cheapest = useMemo(
    () => (userLoc ? cheapestNear(stations, fuel, userLoc, NEARBY_RADIUS_MILES) : null),
    [stations, fuel, userLoc],
  );

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <Text style={styles.title}>Fuel Finder</Text>
        <View style={styles.viewSwitch}>
          {(['map', 'list', 'route'] as const).map(v => (
            <Pressable
              key={v}
              testID={`view-${v}`}
              onPress={() => setView(v)}
              style={[styles.viewBtn, view === v && styles.viewBtnActive]}
            >
              <Text style={[styles.viewBtnText, view === v && styles.viewBtnTextActive]}>
                {v === 'map' ? 'Map' : v === 'list' ? 'List' : 'Route'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      <FuelToggle value={fuel} onChange={changeFuel} />

      {cheapest && view !== 'route' && (
        <Pressable
          style={styles.cheapestBar}
          onPress={() => setSelected(cheapest)}
          testID="cheapest-bar"
        >
          <View style={{ flex: 1 }}>
            <Text style={styles.cheapestLabel}>
              Cheapest {fuelLabel(fuel)} within {NEARBY_RADIUS_MILES} mi
            </Text>
            <Text style={styles.cheapestStation} numberOfLines={1}>
              {cheapest.brand} · {cheapest.address}
            </Text>
            <PriceAge iso={cheapest.priceUpdatedAt} />
          </View>
          <Text style={styles.cheapestPrice}>{formatPrice(cheapest.prices[fuel])}</Text>
        </Pressable>
      )}

      {error && view !== 'route' && <Text style={styles.error}>{error}</Text>}

      <View style={styles.body}>
        {view === 'route' ? (
          <RouteScreen fuel={fuel} userLoc={userLoc} onSelect={setSelected} />
        ) : view === 'map' ? (
          <StationMap
            stations={stations}
            fuel={fuel}
            initialRegion={regionRef.current}
            onRegionChange={onRegionChange}
            onSelect={setSelected}
          />
        ) : (
          <>
            <View style={styles.sortRow}>
              <Text style={styles.sortLabel}>Sort by</Text>
              {(['price', 'distance'] as const).map(m => (
                <Pressable
                  key={m}
                  testID={`sort-${m}`}
                  onPress={() => setSortMode(m)}
                  style={[styles.sortBtn, sortMode === m && styles.sortBtnActive]}
                  disabled={m === 'distance' && !userLoc}
                >
                  <Text
                    style={[
                      styles.sortBtnText,
                      sortMode === m && styles.sortBtnTextActive,
                      m === 'distance' && !userLoc && styles.sortBtnDisabled,
                    ]}
                  >
                    {m === 'price' ? 'Price' : 'Distance'}
                  </Text>
                </Pressable>
              ))}
            </View>
            <FlatList
              data={sorted}
              keyExtractor={s => s.id}
              renderItem={({ item }) => (
                <StationListItem
                  station={item}
                  fuel={fuel}
                  from={userLoc}
                  cheapest={cheapest?.id === item.id}
                  onPress={() => setSelected(item)}
                />
              )}
              ListEmptyComponent={
                loading ? (
                  <ActivityIndicator color={colors.accent} style={{ marginTop: 40 }} />
                ) : (
                  <Text style={styles.empty}>
                    No stations here yet — major-retailer feeds only for now.
                  </Text>
                )
              }
              contentContainerStyle={{ paddingTop: 8, paddingBottom: 30 }}
            />
          </>
        )}
      </View>

      <StationSheet station={selected} fuel={fuel} from={userLoc} onClose={() => setSelected(null)} />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 6,
  },
  title: { color: colors.text, fontSize: 22, fontWeight: '800' },
  viewSwitch: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.pill,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 3,
  },
  viewBtn: { paddingHorizontal: 14, paddingVertical: 5, borderRadius: radii.pill },
  viewBtnActive: { backgroundColor: colors.accent },
  viewBtnText: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  viewBtnTextActive: { color: colors.accentDark },
  cheapestBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginHorizontal: 14,
    marginBottom: 8,
    padding: 12,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.accent,
  },
  cheapestLabel: { color: colors.accent, fontSize: 11, fontWeight: '800', letterSpacing: 0.3 },
  cheapestStation: { color: colors.text, fontSize: 14, fontWeight: '600', marginVertical: 1 },
  cheapestPrice: { color: colors.text, fontSize: 22, fontWeight: '800', fontVariant: ['tabular-nums'] },
  error: { color: colors.amber, fontSize: 12, marginHorizontal: 16, marginBottom: 6 },
  body: { flex: 1 },
  sortRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 16,
    paddingVertical: 6,
  },
  sortLabel: { color: colors.textDim, fontSize: 13 },
  sortBtn: {
    paddingHorizontal: 12,
    paddingVertical: 5,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  sortBtnActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  sortBtnText: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  sortBtnTextActive: { color: colors.accentDark },
  sortBtnDisabled: { opacity: 0.4 },
  empty: { color: colors.textDim, textAlign: 'center', marginTop: 40, paddingHorizontal: 30 },
});
