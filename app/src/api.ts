import AsyncStorage from '@react-native-async-storage/async-storage';
import { Station } from './types';

export const API_BASE = 'https://uk-fuel-finder.nanoluke521.workers.dev';

const CACHE_KEY = 'ff:lastStations';

interface StationFeature {
  geometry: { coordinates: [number, number] };
  properties: {
    id: string;
    brand: string;
    address: string;
    postcode: string;
    prices: Station['prices'];
    priceUpdatedAt: string;
    source: string;
  };
}

function featureToStation(f: StationFeature): Station {
  return {
    id: f.properties.id,
    brand: f.properties.brand,
    address: f.properties.address,
    postcode: f.properties.postcode,
    lon: f.geometry.coordinates[0],
    lat: f.geometry.coordinates[1],
    prices: f.properties.prices,
    priceUpdatedAt: f.properties.priceUpdatedAt,
    source: f.properties.source,
  };
}

export async function fetchStations(bbox: [number, number, number, number]): Promise<Station[]> {
  const res = await fetch(`${API_BASE}/stations?bbox=${bbox.join(',')}`);
  if (!res.ok) throw new Error(`stations ${res.status}`);
  const json = await res.json();
  const stations = (json.features as StationFeature[]).map(featureToStation);
  AsyncStorage.setItem(CACHE_KEY, JSON.stringify(stations)).catch(() => {});
  return stations;
}

// Last successful response, hydrated at launch so the map is usable before
// the first network round-trip completes (cold-start budget is <3s).
export async function loadCachedStations(): Promise<Station[]> {
  try {
    const raw = await AsyncStorage.getItem(CACHE_KEY);
    return raw ? (JSON.parse(raw) as Station[]) : [];
  } catch {
    return [];
  }
}
