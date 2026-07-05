import { FuelCode, LatLon } from './types';

// Pure alert-subscription logic (FF-5). No AsyncStorage or Expo imports here —
// this module is bundled by the unit tests; the side-effectful pieces live in
// favourites.ts and notifications.ts.

export const DEFAULT_QUIET = { start: '21:00', end: '07:00' };
// Matches the "cheapest near you" bar so the two features talk about the same area.
export const AREA_RADIUS_MILES = 5;

export interface AlertPrefs {
  enabled: boolean;
  areaEnabled: boolean;
  quietStart: string;
  quietEnd: string;
}

export const DEFAULT_PREFS: AlertPrefs = {
  enabled: false,
  areaEnabled: true,
  quietStart: DEFAULT_QUIET.start,
  quietEnd: DEFAULT_QUIET.end,
};

export function isValidQuietTime(v: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(v);
}

export function toggleId(list: string[], id: string): string[] {
  return list.includes(id) ? list.filter(x => x !== id) : [...list, id];
}

export interface SubscribePayload {
  token: string;
  fuel: FuelCode;
  favourites: string[];
  area?: { lat: number; lon: number; radiusMiles: number };
  quiet: { start: string; end: string };
}

// The worker validates too, but building a well-formed body here means a typo'd
// quiet hour degrades to the default instead of a rejected subscription.
export function buildSubscribePayload(
  token: string,
  fuel: FuelCode,
  favourites: string[],
  prefs: AlertPrefs,
  userLoc: LatLon | null,
): SubscribePayload {
  return {
    token,
    fuel,
    favourites,
    area:
      prefs.areaEnabled && userLoc
        ? { lat: userLoc.lat, lon: userLoc.lon, radiusMiles: AREA_RADIUS_MILES }
        : undefined,
    quiet: {
      start: isValidQuietTime(prefs.quietStart) ? prefs.quietStart : DEFAULT_QUIET.start,
      end: isValidQuietTime(prefs.quietEnd) ? prefs.quietEnd : DEFAULT_QUIET.end,
    },
  };
}
