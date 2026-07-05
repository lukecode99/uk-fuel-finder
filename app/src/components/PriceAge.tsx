import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { ageIsStale, formatAge } from '../format';
import { colors } from '../theme';

// The one component every screen uses to show how old a price is.
export default function PriceAge({ iso, now }: { iso: string; now?: Date }) {
  const stale = ageIsStale(iso, now);
  return (
    <Text style={[styles.age, stale && styles.stale]} accessibilityLabel={formatAge(iso, now)}>
      {formatAge(iso, now)}
    </Text>
  );
}

const styles = StyleSheet.create({
  age: { color: colors.accent, fontSize: 12, fontVariant: ['tabular-nums'] },
  stale: { color: colors.amber },
});
