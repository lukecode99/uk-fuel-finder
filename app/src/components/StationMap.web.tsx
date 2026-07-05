import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { FuelCode, MapRegion, Station } from '../types';
import { colors } from '../theme';

// react-native-maps has no web implementation. The web export exists for
// local verification and a gh-pages demo (FF-8) — the map tab explains
// itself and points at the list, which is fully functional on web.
export default function StationMap({
  stations,
}: {
  stations: Station[];
  fuel: FuelCode;
  initialRegion: MapRegion;
  onRegionChange: (r: MapRegion) => void;
  onSelect: (s: Station) => void;
}) {
  return (
    <View style={styles.wrap} testID="map-web-fallback">
      <Text style={styles.title}>Map view is native-only</Text>
      <Text style={styles.sub}>
        {stations.length} stations loaded — switch to the List tab. The interactive map ships in
        the iOS app.
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 30, gap: 8 },
  title: { color: colors.text, fontSize: 17, fontWeight: '700' },
  sub: { color: colors.textDim, fontSize: 13, textAlign: 'center' },
});
