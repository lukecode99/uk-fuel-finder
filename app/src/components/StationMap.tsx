import React, { useMemo, useRef } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-map-clustering';
import { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { FuelCode, MapRegion, Station } from '../types';
import { formatPrice, shortAge } from '../format';
import { colors } from '../theme';

export interface MapHandle {}

// Marker colour tiers relative to the visible set: cheapest third green,
// middle amber, dearest third red — quick visual scan for cheap fuel.
function tierColor(price: number | undefined, sorted: number[]): string {
  if (price == null || sorted.length === 0) return colors.textDim;
  const idx = sorted.findIndex(p => price <= p);
  const frac = (idx === -1 ? sorted.length : idx) / sorted.length;
  if (frac <= 1 / 3) return colors.cheap;
  if (frac <= 2 / 3) return colors.mid;
  return colors.dear;
}

export default function StationMap({
  stations,
  fuel,
  initialRegion,
  onRegionChange,
  onSelect,
}: {
  stations: Station[];
  fuel: FuelCode;
  initialRegion: MapRegion;
  onRegionChange: (r: MapRegion) => void;
  onSelect: (s: Station) => void;
}) {
  const mapRef = useRef(null);
  const sortedPrices = useMemo(
    () =>
      stations
        .map(s => s.prices[fuel])
        .filter((p): p is number => p != null)
        .sort((a, b) => a - b),
    [stations, fuel],
  );

  return (
    <MapView
      ref={mapRef}
      style={StyleSheet.absoluteFill}
      provider={PROVIDER_DEFAULT}
      initialRegion={initialRegion}
      onRegionChangeComplete={onRegionChange}
      showsUserLocation
      clusterColor={colors.card}
      clusterTextColor={colors.text}
      radius={44}
      userInterfaceStyle="dark"
    >
      {stations.map(s => (
        <Marker
          key={s.id}
          coordinate={{ latitude: s.lat, longitude: s.lon }}
          onPress={() => onSelect(s)}
          tracksViewChanges={false}
        >
          <View style={[styles.marker, { borderColor: tierColor(s.prices[fuel], sortedPrices) }]}>
            <Text style={styles.markerPrice}>{formatPrice(s.prices[fuel])}</Text>
            <Text style={styles.markerAge}>{shortAge(s.priceUpdatedAt)}</Text>
          </View>
        </Marker>
      ))}
    </MapView>
  );
}

const styles = StyleSheet.create({
  marker: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 3,
    backgroundColor: colors.card,
    borderWidth: 1.5,
    borderRadius: 10,
    paddingHorizontal: 6,
    paddingVertical: 3,
  },
  markerPrice: { color: colors.text, fontWeight: '800', fontSize: 12 },
  markerAge: { color: colors.textDim, fontSize: 9 },
});
