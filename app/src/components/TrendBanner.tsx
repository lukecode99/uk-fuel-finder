import React, { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { FuelCode, LatLon, Station } from '../types';
import {
  FillSignal,
  areaSeries,
  computeTrend,
  fetchHistory,
  fillNowSignal,
  nearestWithFuel,
} from '../history';
import { fuelLabel } from '../fuel';
import { colors, radii } from '../theme';

const SAMPLE_SIZE = 10;

// "Prices near you falling/rising this week" + the fill-now verdict, computed
// from the daily history of the nearest stations. Tap to see the numbers the
// rule used — the signal is a stated calculation, not a black box.
export default function TrendBanner({
  stations,
  fuel,
  userLoc,
}: {
  stations: Station[];
  fuel: FuelCode;
  userLoc: LatLon | null;
}) {
  const [signal, setSignal] = useState<FillSignal | null>(null);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!userLoc || stations.length === 0) return;
    let live = true;
    const sample = nearestWithFuel(stations, fuel, userLoc, SAMPLE_SIZE);
    Promise.all(sample.map(s => fetchHistory(s.id, fuel).catch(() => [])))
      .then(histories => {
        if (!live) return;
        const trend = computeTrend(areaSeries(histories.filter(h => h.length > 0)));
        setSignal(fillNowSignal(trend, fuelLabel(fuel)));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
    // Deliberately keyed on fuel + location only: re-sampling on every map pan
    // would spam /history for no signal change.
  }, [fuel, userLoc?.lat, userLoc?.lon, stations.length === 0]);

  if (!signal) return null;

  return (
    <Pressable
      style={[
        styles.banner,
        signal.action === 'fill-now' && styles.bannerFill,
        signal.action === 'wait' && styles.bannerWait,
      ]}
      onPress={() => setExpanded(e => !e)}
      testID="trend-banner"
    >
      <Text
        style={[
          styles.headline,
          signal.action === 'fill-now' && { color: colors.dear },
          signal.action === 'wait' && { color: colors.cheap },
        ]}
        testID="trend-headline"
      >
        {signal.headline}
        <Text style={styles.tapHint}>{expanded ? '' : '  · why?'}</Text>
      </Text>
      {expanded && (
        <Text style={styles.explanation} testID="trend-explanation">
          {signal.explanation}
        </Text>
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    marginHorizontal: 14,
    marginBottom: 8,
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    gap: 4,
  },
  bannerFill: { borderColor: colors.dear },
  bannerWait: { borderColor: colors.cheap },
  headline: { color: colors.text, fontSize: 13, fontWeight: '700' },
  tapHint: { color: colors.textDim, fontWeight: '400', fontSize: 12 },
  explanation: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
});
