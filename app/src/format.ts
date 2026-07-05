// Price-age formatting. Every price shown anywhere in the app carries its
// age — this is the product's honesty differentiator, so there is one
// canonical implementation and everything renders through it.
export function formatAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!isFinite(ms)) return 'age unknown';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'updated just now';
  if (min < 60) return `updated ${min} min ago`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `updated ${hrs} hr${hrs === 1 ? '' : 's'} ago`;
  const days = Math.floor(hrs / 24);
  return `updated ${days} day${days === 1 ? '' : 's'} ago`;
}

// Compact form for map markers where space is tight: "now", "12m", "3h", "2d".
export function shortAge(iso: string, now: Date = new Date()): string {
  const ms = now.getTime() - new Date(iso).getTime();
  if (!isFinite(ms)) return '?';
  const min = Math.floor(ms / 60000);
  if (min < 1) return 'now';
  if (min < 60) return `${min}m`;
  const hrs = Math.floor(min / 60);
  if (hrs < 24) return `${hrs}h`;
  return `${Math.floor(hrs / 24)}d`;
}

// Ages over a day render amber/grey rather than fresh green.
export function ageIsStale(iso: string, now: Date = new Date()): boolean {
  return now.getTime() - new Date(iso).getTime() > 24 * 3600 * 1000;
}

export function formatPrice(pencePerLitre: number | undefined): string {
  if (pencePerLitre == null) return '—';
  return `${pencePerLitre.toFixed(1)}p`;
}

export function formatDistance(miles: number): string {
  if (miles < 0.1) return 'nearby';
  return `${miles.toFixed(1)} mi`;
}
