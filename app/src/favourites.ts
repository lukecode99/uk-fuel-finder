import AsyncStorage from '@react-native-async-storage/async-storage';
import { toggleId } from './alerts';

const KEY = 'ff:favourites';

export async function loadFavourites(): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch {
    return [];
  }
}

export async function toggleFavourite(id: string): Promise<string[]> {
  const next = toggleId(await loadFavourites(), id);
  AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
  return next;
}
