import { Platform } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { API_BASE } from './config';
import { AlertPrefs, DEFAULT_PREFS, buildSubscribePayload } from './alerts';
import { FuelCode, LatLon } from './types';

const PREFS_KEY = 'ff:alertPrefs';
const TOKEN_KEY = 'ff:pushToken';

export async function loadPrefs(): Promise<AlertPrefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    return raw ? { ...DEFAULT_PREFS, ...(JSON.parse(raw) as AlertPrefs) } : { ...DEFAULT_PREFS };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: AlertPrefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs)).catch(() => {});
}

// Expo push token, or null when this device can't receive pushes (web build,
// permission declined, simulator without a dev build). Callers surface why.
export async function getPushToken(): Promise<string | null> {
  if (Platform.OS === 'web') return null;
  try {
    const Notifications = await import('expo-notifications');
    const perms = await Notifications.requestPermissionsAsync();
    if (!perms.granted) return null;
    const token = await Notifications.getExpoPushTokenAsync();
    const data = token.data ?? null;
    if (data) await AsyncStorage.setItem(TOKEN_KEY, data).catch(() => {});
    return data;
  } catch {
    return null;
  }
}

export async function subscribeAlerts(
  token: string,
  fuel: FuelCode,
  favourites: string[],
  prefs: AlertPrefs,
  userLoc: LatLon | null,
): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/alerts/subscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(buildSubscribePayload(token, fuel, favourites, prefs, userLoc)),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function unsubscribeAlerts(token: string): Promise<boolean> {
  try {
    const res = await fetch(`${API_BASE}/alerts/unsubscribe`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

// Favourites changed (or fuel switched) while alerts are on: the subscribe
// endpoint overwrites, so a re-subscribe is the whole sync story.
export async function resyncIfSubscribed(
  fuel: FuelCode,
  favourites: string[],
  userLoc: LatLon | null,
): Promise<void> {
  const prefs = await loadPrefs();
  if (!prefs.enabled) return;
  const token = await AsyncStorage.getItem(TOKEN_KEY).catch(() => null);
  if (!token) return;
  await subscribeAlerts(token, fuel, favourites, prefs, userLoc);
}
