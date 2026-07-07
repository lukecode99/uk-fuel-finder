import React, { useEffect, useState } from 'react';
import { Linking, Modal, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import * as Haptics from 'expo-haptics';
import { FUELS, fuelLabel } from '../fuel';
import { FuelCode, LatLon, Station } from '../types';
import { formatDistance, formatPrice } from '../format';
import { haversineMiles } from '../geo';
import { HistoryPoint, computeTrend, fetchHistory } from '../history';
import { affiliateLinks } from '../affiliates';
import { logLinkOut } from '../linkouts';
import { colors, radii } from '../theme';
import PriceAge from './PriceAge';
import Sparkline from './Sparkline';

const FACILITY_LABELS: Record<string, string> = {
  shop: 'Shop',
  coffee: 'Coffee',
  food: 'Food',
  toilet: 'Toilets',
  'car-wash': 'Car Wash',
  services: 'Services',
};

function directionsUrl(s: Station): string {
  const dest = `${s.lat},${s.lon}`;
  return Platform.OS === 'ios'
    ? `http://maps.apple.com/?daddr=${dest}`
    : `https://www.google.com/maps/dir/?api=1&destination=${dest}`;
}

export default function StationSheet({
  station,
  fuel,
  from,
  favourite,
  onToggleFavourite,
  onClose,
}: {
  station: Station | null;
  fuel: FuelCode;
  from: LatLon | null;
  favourite: boolean;
  onToggleFavourite: (id: string) => void;
  onClose: () => void;
}) {
  const [history, setHistory] = useState<HistoryPoint[] | null>(null);

  useEffect(() => {
    setHistory(null);
    if (!station) return;
    let live = true;
    fetchHistory(station.id, fuel)
      .then(pts => live && setHistory(pts))
      .catch(() => live && setHistory([]));
    return () => {
      live = false;
    };
  }, [station?.id, fuel]);

  const trend = history ? computeTrend(history) : null;
  // Empty until affiliate partner ids are configured — the whole section
  // stays out of the tree with the shipped (all-off) config.
  const offers = affiliateLinks();

  return (
    <Modal
      visible={!!station}
      transparent
      animationType="slide"
      onRequestClose={onClose}
      onShow={() => Haptics.selectionAsync()}
    >
      <Pressable style={styles.backdrop} onPress={onClose} testID="sheet-backdrop" />
      {station && (
        <View style={styles.sheet} testID="station-sheet">
          <View style={styles.handle} />
          <View style={styles.brandRow}>
            <Text style={styles.brand}>{station.brand}</Text>
            <Pressable
              onPress={() => {
                Haptics.selectionAsync();
                onToggleFavourite(station.id);
              }}
              hitSlop={10}
              testID="favourite-btn"
            >
              <Text style={[styles.star, favourite && styles.starOn]}>
                {favourite ? '★' : '☆'}
              </Text>
            </Pressable>
          </View>
          {favourite && (
            <Text style={styles.favNote} testID="favourite-note">
              Favourite — you'll get a push if {fuelLabel(fuel)} here drops 1p/L or more.
            </Text>
          )}
          <Text style={styles.address}>
            {station.address} · {station.postcode}
            {from ? ` · ${formatDistance(haversineMiles(from, station))}` : ''}
          </Text>
          <PriceAge iso={station.priceUpdatedAt} />
          <View style={styles.priceTable}>
            {FUELS.map(f => {
              const p = station.prices[f.code];
              const selected = f.code === fuel;
              return (
                <View key={f.code} style={[styles.priceRow, selected && styles.priceRowSel]}>
                  <View>
                    <Text style={[styles.fuelName, selected && styles.fuelNameSel]}>{f.label}</Text>
                    <Text style={styles.fuelSub}>{f.sub}</Text>
                  </View>
                  <Text style={[styles.fuelPrice, p == null && styles.fuelPriceNone]}>
                    {formatPrice(p)}
                  </Text>
                </View>
              );
            })}
          </View>
          {station.facilities && station.facilities.length > 0 && (
            <View style={styles.facilityRow} testID="facility-chips">
              {station.facilities.map(f => (
                <View key={f} style={styles.facilityChip}>
                  <Text style={styles.facilityText}>{FACILITY_LABELS[f] ?? f}</Text>
                </View>
              ))}
            </View>
          )}
          <View style={styles.historyBox} testID="history-box">
            <Text style={styles.historyTitle}>
              {fuelLabel(fuel)} — last 14 days
              {trend && (
                <Text
                  style={[
                    styles.trendWord,
                    trend.direction === 'falling' && { color: colors.cheap },
                    trend.direction === 'rising' && { color: colors.dear },
                  ]}
                  testID="station-trend"
                >
                  {'  '}
                  {trend.direction === 'steady'
                    ? 'steady'
                    : `${trend.direction} ${Math.abs(trend.changePence).toFixed(1)}p`}
                </Text>
              )}
            </Text>
            {history === null ? (
              <Text style={styles.historyNote}>Loading price history…</Text>
            ) : history.length >= 2 ? (
              <Sparkline points={history} />
            ) : (
              <Text style={styles.historyNote} testID="history-building">
                Price history for this station is still building — daily points appear from the
                first day we track it.
              </Text>
            )}
          </View>
          <Pressable
            style={styles.directionsBtn}
            onPress={() => Linking.openURL(directionsUrl(station))}
            testID="directions-btn"
          >
            <Text style={styles.directionsText}>Directions ↗</Text>
          </Pressable>
          {offers.length > 0 && (
            <View style={styles.offerBox} testID="affiliate-box">
              <Text style={styles.offerTitle}>Cut your running costs</Text>
              {offers.map(link => (
                <Pressable
                  key={link.key}
                  style={styles.offerBtn}
                  testID={`affiliate-${link.key}`}
                  onPress={() => {
                    // Log first, then leave — logging never blocks the tap.
                    logLinkOut(link, station.id).catch(() => {});
                    Linking.openURL(link.url);
                  }}
                >
                  <Text style={styles.offerText}>{link.cta} ↗</Text>
                </Pressable>
              ))}
              <Text style={styles.offerNote}>Ad — we may earn a commission.</Text>
            </View>
          )}
        </View>
      )}
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.45)' },
  sheet: {
    backgroundColor: colors.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 18,
    paddingBottom: 34,
    gap: 6,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sheetHandle,
    marginBottom: 8,
  },
  brandRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  brand: { color: colors.text, fontSize: 20, fontWeight: '800' },
  star: { color: colors.textDim, fontSize: 24, lineHeight: 26 },
  starOn: { color: colors.amber },
  favNote: { color: colors.textDim, fontSize: 11 },
  address: { color: colors.textDim, fontSize: 13 },
  priceTable: {
    marginTop: 10,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    overflow: 'hidden',
  },
  priceRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingHorizontal: 14,
    paddingVertical: 11,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.cardBorder,
  },
  priceRowSel: { backgroundColor: colors.accentDark },
  fuelName: { color: colors.textDim, fontSize: 14 },
  fuelNameSel: { color: colors.accent, fontWeight: '700' },
  fuelSub: { color: colors.textDim, fontSize: 10, opacity: 0.6 },
  fuelPrice: { color: colors.text, fontWeight: '700', fontVariant: ['tabular-nums'] },
  fuelPriceNone: { color: colors.textDim, fontWeight: '400' },
  facilityRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 8 },
  facilityChip: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 12,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  facilityText: { color: colors.textDim, fontSize: 11, fontWeight: '600' },
  historyBox: {
    marginTop: 10,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    gap: 8,
  },
  historyTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  trendWord: { fontWeight: '800' },
  historyNote: { color: colors.textDim, fontSize: 12, lineHeight: 17 },
  directionsBtn: {
    marginTop: 14,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  directionsText: { color: colors.accentDark, fontWeight: '800', fontSize: 15 },
  offerBox: {
    marginTop: 10,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    padding: 12,
    gap: 8,
  },
  offerTitle: { color: colors.textDim, fontSize: 12, fontWeight: '700' },
  offerBtn: {
    backgroundColor: colors.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingVertical: 10,
    alignItems: 'center',
  },
  offerText: { color: colors.text, fontWeight: '600', fontSize: 13 },
  offerNote: { color: colors.textDim, fontSize: 10 },
});
