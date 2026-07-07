import React from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { FUELS } from '../fuel';
import { FuelCode } from '../types';
import { colors, radii } from '../theme';

export default function FuelToggle({
  value,
  onChange,
}: {
  value: FuelCode;
  onChange: (f: FuelCode) => void;
}) {
  const petrolFuels = FUELS.filter(f => f.code === 'E10' || f.code === 'E5');
  const dieselFuels = FUELS.filter(f => f.code === 'B7' || f.code === 'SDV');

  const renderPill = (f: { code: FuelCode; short: string; sub: string }) => {
    const active = f.code === value;
    return (
      <Pressable
        key={f.code}
        testID={`fuel-${f.code}`}
        onPress={() => onChange(f.code)}
        style={[styles.pill, active && styles.pillActive]}
        accessibilityRole="button"
        accessibilityState={{ selected: active }}
      >
        <Text style={[styles.label, active && styles.labelActive]}>{f.short}</Text>
        <Text style={[styles.sub, active && styles.subActive]}>{f.sub}</Text>
      </Pressable>
    );
  };

  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={styles.row}
      style={styles.scroll}
    >
      <Text style={styles.groupLabel}>Petrol</Text>
      {petrolFuels.map(renderPill)}
      <View style={styles.groupDivider} />
      <Text style={styles.groupLabel}>Diesel</Text>
      {dieselFuels.map(renderPill)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  scroll: { flexGrow: 0 },
  row: { gap: 8, paddingHorizontal: 14, paddingVertical: 8, alignItems: 'center' },
  groupLabel: {
    color: colors.textDim,
    fontSize: 10,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  groupDivider: {
    width: 1,
    height: 28,
    backgroundColor: colors.cardBorder,
    marginHorizontal: 4,
  },
  pill: {
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  label: { color: colors.textDim, fontWeight: '600', fontSize: 13 },
  labelActive: { color: colors.accentDark },
  sub: { color: colors.textDim, fontSize: 10, fontWeight: '500', opacity: 0.7, textAlign: 'center' },
  subActive: { color: colors.accentDark, opacity: 0.8 },
});
