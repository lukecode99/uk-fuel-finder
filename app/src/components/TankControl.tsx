import React, { useRef, useState } from 'react';
import { LayoutChangeEvent, PanResponder, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import {
  MAX_TANK_LITRES,
  MIN_TANK_LITRES,
  TANK_PRESETS,
  fractionForLitres,
  litresFromFraction,
  parseLitres,
  presetKeyFor,
} from '../tank';
import { colors, radii } from '../theme';

const THUMB = 22;

// Tank size picker for the fill-cost display (FF-11): preset chips, a slider
// for in-between sizes, and an editable litres field that overrides both.
// The slider is a plain PanResponder track — RN core has no Slider, and a
// community one isn't worth a new dependency for a single control.
export default function TankControl({
  litres,
  onChange,
}: {
  litres: number;
  onChange: (litres: number) => void;
}) {
  const [trackWidth, setTrackWidth] = useState(0);
  const [draft, setDraft] = useState<string | null>(null);
  const trackRef = useRef<View>(null);
  const trackX = useRef(0);
  const widthRef = useRef(0);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  const moveTo = (pageX: number) => {
    const usable = widthRef.current - THUMB;
    if (usable <= 0) return;
    onChangeRef.current(litresFromFraction((pageX - trackX.current - THUMB / 2) / usable));
  };

  const pan = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: e => moveTo(e.nativeEvent.pageX),
      onPanResponderMove: e => moveTo(e.nativeEvent.pageX),
    }),
  ).current;

  const onTrackLayout = (e: LayoutChangeEvent) => {
    widthRef.current = e.nativeEvent.layout.width;
    setTrackWidth(e.nativeEvent.layout.width);
    trackRef.current?.measureInWindow((x: number) => {
      trackX.current = x;
    });
  };

  const commitDraft = () => {
    if (draft != null) {
      const parsed = parseLitres(draft);
      if (parsed != null) onChange(parsed);
    }
    setDraft(null);
  };

  const activePreset = presetKeyFor(litres);
  const thumbLeft = fractionForLitres(litres) * Math.max(0, trackWidth - THUMB);

  return (
    <View style={styles.wrap}>
      <View style={styles.row}>
        {TANK_PRESETS.map(p => {
          const active = p.key === activePreset;
          return (
            <Pressable
              key={p.key}
              testID={`tank-${p.key}`}
              onPress={() => onChange(p.litres)}
              style={[styles.pill, active && styles.pillActive]}
              accessibilityRole="button"
              accessibilityState={{ selected: active }}
            >
              <Text style={[styles.pillLabel, active && styles.pillLabelActive]}>
                {p.label} {p.litres}L
              </Text>
            </Pressable>
          );
        })}
        <TextInput
          testID="tank-litres"
          style={styles.input}
          value={draft ?? String(litres)}
          onChangeText={setDraft}
          onFocus={() => setDraft(String(litres))}
          onBlur={commitDraft}
          onSubmitEditing={commitDraft}
          keyboardType="number-pad"
          returnKeyType="done"
          maxLength={3}
          accessibilityLabel="Tank size in litres"
        />
        <Text style={styles.unit}>L</Text>
      </View>
      <View
        ref={trackRef}
        style={styles.track}
        onLayout={onTrackLayout}
        {...pan.panHandlers}
        accessibilityRole="adjustable"
        accessibilityLabel={`Tank size ${litres} litres`}
        accessibilityValue={{ min: MIN_TANK_LITRES, max: MAX_TANK_LITRES, now: litres }}
      >
        <View style={styles.trackLine} />
        <View style={[styles.trackFill, { width: thumbLeft + THUMB / 2 }]} />
        <View style={[styles.thumb, { left: thumbLeft }]} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: 14, paddingBottom: 8, gap: 6 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  pill: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: radii.pill,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
  },
  pillActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  pillLabel: { color: colors.textDim, fontWeight: '600', fontSize: 12 },
  pillLabelActive: { color: colors.accentDark },
  input: {
    marginLeft: 'auto',
    minWidth: 44,
    textAlign: 'center',
    color: colors.text,
    fontWeight: '700',
    fontSize: 13,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.cardBorder,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 5,
  },
  unit: { color: colors.textDim, fontSize: 12, fontWeight: '600' },
  track: { height: 28, justifyContent: 'center' },
  trackLine: {
    position: 'absolute',
    left: THUMB / 2,
    right: THUMB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.cardBorder,
  },
  trackFill: {
    position: 'absolute',
    left: THUMB / 2,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.accent,
  },
  thumb: {
    position: 'absolute',
    width: THUMB,
    height: THUMB,
    borderRadius: THUMB / 2,
    backgroundColor: colors.accent,
    borderWidth: 2,
    borderColor: colors.accentDark,
  },
});
