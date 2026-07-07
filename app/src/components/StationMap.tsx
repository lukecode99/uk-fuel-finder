import React, { useMemo, useRef } from 'react';
import { LayoutAnimation, StyleSheet, Text, View } from 'react-native';
import MapView from 'react-native-map-clustering';
import { Marker, PROVIDER_DEFAULT } from 'react-native-maps';
import { FuelCode, MapRegion, Station } from '../types';
import { shortAge } from '../format';
import { PriceDisplay, stationPriceText } from '../tank';
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
  display,
  tankLitres,
  initialRegion,
  onRegionChange,
  onSelect,
}: {
  stations: Station[];
  fuel: FuelCode;
  display: PriceDisplay;
  tankLitres: number;
  initialRegion: MapRegion;
  onRegionChange: (r: MapRegion) => void;
  onSelect: (s: Station) => void;
}) {
  const mapRef = useRef(null);
  const superClusterRef = useRef<any>(null);
  const sortedPrices = useMemo(
    () =>
      stations
        .map(s => s.prices[fuel])
        .filter((p): p is number => p != null)
        .sort((a, b) => a - b),
    [stations, fuel],
  );

  // react-native-map-clustering@3.4 declares its defaults through
  // ClusteredMapView.defaultProps, which React 19 ignores on function
  // components — every default arrives as undefined at runtime. On device
  // that was fatal: the lib's ref callback unconditionally calls
  // restProps.mapRef(map), so an undefined mapRef threw on mount and
  // aborted the app; it also silently disabled clustering. Until the lib
  // supports React 19, pass its entire former-default set explicitly.
  // test/run.mjs keeps this list in sync with the lib's defaultProps.
  return (
    <MapView
      ref={mapRef}
      mapRef={() => {}}
      superClusterRef={superClusterRef}
      clusteringEnabled
      spiralEnabled
      animationEnabled
      preserveClusterPressBehavior={false}
      layoutAnimationConf={LayoutAnimation.Presets.spring}
      tracksViewChanges={false}
      maxZoom={20}
      minZoom={1}
      minPoints={2}
      extent={512}
      nodeSize={64}
      edgePadding={{ top: 50, left: 50, right: 50, bottom: 50 }}
      spiderLineColor="#FF0000"
      onClusterPress={() => {}}
      onMarkersChange={() => {}}
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
            <Text style={styles.markerPrice}>
              {stationPriceText(display, s.prices[fuel], tankLitres)}
            </Text>
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
