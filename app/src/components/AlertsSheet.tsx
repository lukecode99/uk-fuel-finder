import React, { useEffect, useState } from 'react';
import { Modal, Platform, Pressable, StyleSheet, Switch, Text, TextInput, View } from 'react-native';
import { FuelCode, LatLon } from '../types';
import { AlertPrefs, DEFAULT_PREFS } from '../alerts';
import { fuelLabel } from '../fuel';
import {
  getPushToken,
  loadPrefs,
  savePrefs,
  subscribeAlerts,
  unsubscribeAlerts,
} from '../notifications';
import { colors, radii } from '../theme';

export default function AlertsSheet({
  visible,
  onClose,
  fuel,
  favourites,
  userLoc,
}: {
  visible: boolean;
  onClose: () => void;
  fuel: FuelCode;
  favourites: string[];
  userLoc: LatLon | null;
}) {
  const [prefs, setPrefs] = useState<AlertPrefs>({ ...DEFAULT_PREFS });
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    if (visible) loadPrefs().then(setPrefs);
  }, [visible]);

  const update = async (next: AlertPrefs) => {
    setPrefs(next);
    await savePrefs(next);
    // Settings changed while subscribed: the subscribe endpoint overwrites,
    // so pushing the new payload up is the whole update.
    if (next.enabled && token) await subscribeAlerts(token, fuel, favourites, next, userLoc);
  };

  const toggleEnabled = async (on: boolean) => {
    setBusy(true);
    setNote(null);
    try {
      if (on) {
        const t = token ?? (await getPushToken());
        if (!t) {
          setNote(
            Platform.OS === 'web'
              ? 'Push alerts need the iOS app — this web preview can’t receive notifications.'
              : 'Notification permission was declined — enable it in Settings to get alerts.',
          );
          return;
        }
        setToken(t);
        const ok = await subscribeAlerts(t, fuel, favourites, { ...prefs, enabled: true }, userLoc);
        if (!ok) {
          setNote('Could not reach the alert service — try again in a minute.');
          return;
        }
        await update({ ...prefs, enabled: true });
      } else {
        if (token) await unsubscribeAlerts(token);
        await update({ ...prefs, enabled: false });
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} testID="alerts-backdrop" />
      <View style={styles.sheet} testID="alerts-sheet">
        <View style={styles.handle} />
        <Text style={styles.title}>Price-drop alerts</Text>
        <Text style={styles.sub}>
          A push when a favourite station drops 1p/L or more, or the cheapest {fuelLabel(fuel)}{' '}
          near you drops 2p/L or more.
        </Text>

        <View style={styles.row}>
          <Text style={styles.rowLabel}>Push alerts</Text>
          <Switch
            value={prefs.enabled}
            onValueChange={toggleEnabled}
            disabled={busy}
            testID="alerts-toggle"
            trackColor={{ true: colors.accent }}
          />
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Home-area alerts</Text>
            <Text style={styles.rowHint}>Cheapest price within 5 mi of your location</Text>
          </View>
          <Switch
            value={prefs.areaEnabled}
            onValueChange={v => update({ ...prefs, areaEnabled: v })}
            disabled={busy}
            testID="area-toggle"
            trackColor={{ true: colors.accent }}
          />
        </View>

        <View style={styles.row}>
          <View style={{ flex: 1 }}>
            <Text style={styles.rowLabel}>Quiet hours</Text>
            <Text style={styles.rowHint}>Alerts held overnight arrive as one morning summary</Text>
          </View>
          <TextInput
            style={styles.timeInput}
            value={prefs.quietStart}
            onChangeText={v => update({ ...prefs, quietStart: v })}
            placeholder="21:00"
            placeholderTextColor={colors.textDim}
            testID="quiet-start"
          />
          <Text style={styles.timeDash}>–</Text>
          <TextInput
            style={styles.timeInput}
            value={prefs.quietEnd}
            onChangeText={v => update({ ...prefs, quietEnd: v })}
            placeholder="07:00"
            placeholderTextColor={colors.textDim}
            testID="quiet-end"
          />
        </View>

        <Text style={styles.favCount} testID="alerts-fav-count">
          {favourites.length === 0
            ? 'No favourite stations yet — tap the star on any station to add one.'
            : `Watching ${favourites.length} favourite station${favourites.length === 1 ? '' : 's'}.`}
        </Text>

        {note && (
          <Text style={styles.note} testID="alerts-note">
            {note}
          </Text>
        )}

        <Pressable style={styles.doneBtn} onPress={onClose} testID="alerts-done">
          <Text style={styles.doneText}>Done</Text>
        </Pressable>
      </View>
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
    gap: 10,
  },
  handle: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.sheetHandle,
    marginBottom: 8,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: '800' },
  sub: { color: colors.textDim, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
    backgroundColor: colors.card,
    borderRadius: radii.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  rowLabel: { color: colors.text, fontSize: 14, fontWeight: '600', flexShrink: 1 },
  rowHint: { color: colors.textDim, fontSize: 11, marginTop: 2 },
  timeInput: {
    color: colors.text,
    backgroundColor: colors.bg,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    paddingHorizontal: 8,
    paddingVertical: 5,
    fontSize: 13,
    minWidth: 58,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  timeDash: { color: colors.textDim },
  favCount: { color: colors.textDim, fontSize: 12 },
  note: { color: colors.amber, fontSize: 12, lineHeight: 17 },
  doneBtn: {
    marginTop: 6,
    backgroundColor: colors.accent,
    borderRadius: radii.card,
    paddingVertical: 13,
    alignItems: 'center',
  },
  doneText: { color: colors.accentDark, fontWeight: '800', fontSize: 15 },
});
