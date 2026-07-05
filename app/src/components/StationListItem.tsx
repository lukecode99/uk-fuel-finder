import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { FuelCode, LatLon, Station } from '../types';
import { formatDistance, formatPrice } from '../format';
import { haversineMiles } from '../geo';
import { colors, radii } from '../theme';
import PriceAge from './PriceAge';

export default function StationListItem({
  station,
  fuel,
  from,
  cheapest,
  onPress,
}: {
  station: Station;
  fuel: FuelCode;
  from: LatLon | null;
  cheapest: boolean;
  onPress: () => void;
}) {
  const price = station.prices[fuel];
  return (
    <Pressable style={styles.card} onPress={onPress} testID={`station-${station.id}`}>
      <View style={styles.left}>
        <Text style={styles.brand}>
          {station.brand}
          {cheapest && <Text style={styles.cheapTag}>  CHEAPEST</Text>}
        </Text>
        <Text style={styles.address} numberOfLines={1}>
          {station.address} · {station.postcode}
        </Text>
        <PriceAge iso={station.priceUpdatedAt} />
      </View>
      <View style={styles.right}>
        <Text style={[styles.price, price == null && styles.noPrice]}>{formatPrice(price)}</Text>
        {from && <Text style={styles.distance}>{formatDistance(haversineMiles(from, station))}</Text>}
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    marginHorizontal: 14,
    marginBottom: 8,
    alignItems: 'center',
  },
  left: { flex: 1, gap: 2 },
  brand: { color: colors.text, fontWeight: '700', fontSize: 15 },
  cheapTag: { color: colors.accent, fontSize: 11, fontWeight: '800' },
  address: { color: colors.textDim, fontSize: 12 },
  right: { alignItems: 'flex-end', gap: 2, marginLeft: 10 },
  price: { color: colors.text, fontWeight: '800', fontSize: 18, fontVariant: ['tabular-nums'] },
  noPrice: { color: colors.textDim, fontWeight: '400' },
  distance: { color: colors.textDim, fontSize: 12 },
});
