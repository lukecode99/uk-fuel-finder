import AsyncStorage from '@react-native-async-storage/async-storage';
import { AffiliateLink, LinkOutEntry, appendLinkOut } from './affiliates';

const KEY = 'ff:linkOuts';

export async function loadLinkOuts(): Promise<LinkOutEntry[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function logLinkOut(link: AffiliateLink, stationId: string | null): Promise<void> {
  const entry: LinkOutEntry = {
    timestamp: Date.now(),
    key: link.key,
    stationId,
    url: link.url,
  };
  const next = appendLinkOut(await loadLinkOuts(), entry);
  // Logging must never break the link-out itself.
  await AsyncStorage.setItem(KEY, JSON.stringify(next)).catch(() => {});
}
