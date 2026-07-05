import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { HistoryPoint, sparkHeights } from '../history';
import { colors } from '../theme';

const BAR_AREA_HEIGHT = 36;
const MIN_BAR = 4;

// Dependency-free daily-price sparkline: one bar per stored day. Bars, not a
// path, so it renders identically on native and the web export.
export default function Sparkline({ points }: { points: HistoryPoint[] }) {
  if (points.length === 0) return null;
  const heights = sparkHeights(points);
  const first = points[0];
  const last = points[points.length - 1];
  const rising = last.price > first.price;
  const falling = last.price < first.price;
  const barColor = falling ? colors.cheap : rising ? colors.dear : colors.textDim;
  return (
    <View testID="sparkline">
      <View style={styles.bars}>
        {heights.map((h, i) => (
          <View
            key={points[i].date}
            testID={`spark-bar-${points[i].date}`}
            style={[
              styles.bar,
              { height: MIN_BAR + h * (BAR_AREA_HEIGHT - MIN_BAR), backgroundColor: barColor },
            ]}
          />
        ))}
      </View>
      <Text style={styles.caption} testID="spark-caption">
        {first.price.toFixed(1)}p → {last.price.toFixed(1)}p · {points.length} day
        {points.length === 1 ? '' : 's'} of history
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bars: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    height: BAR_AREA_HEIGHT,
  },
  bar: { flex: 1, maxWidth: 18, borderRadius: 2 },
  caption: { color: colors.textDim, fontSize: 11, marginTop: 4 },
});
