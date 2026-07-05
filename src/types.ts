// Fuel codes follow the government scheme: E10/E5 petrol, B7 diesel, SDV super/premium diesel.
export interface StationPrices {
  E10?: number;
  E5?: number;
  B7?: number;
  SDV?: number;
}

export interface Station {
  id: string; // source-qualified, e.g. "mfg:gcp6cwwx0tje"
  siteId: string;
  brand: string;
  address: string;
  postcode: string;
  lat: number;
  lng: number;
  prices: StationPrices; // pence per litre
  priceUpdatedAt: string; // ISO 8601 — when the source last updated these prices
  source: string;
}

export interface SourceStatus {
  name: string;
  ok: boolean; // last fetch attempt succeeded
  stationCount: number;
  feedUpdatedAt: string | null; // the feed's own last_updated stamp
  lastFetchAt: string | null; // when we last successfully pulled it
  error?: string;
}

export interface Snapshot {
  ingestedAt: string;
  sources: SourceStatus[];
  stations: Station[];
}

export interface Env {
  FUEL_KV: KVNamespace;
  // Official Fuel Finder API — dormant until app registration completes.
  FF_CLIENT_ID?: string;
  FF_CLIENT_SECRET?: string;
  FF_API_BASE?: string;
  FF_TOKEN_URL?: string;
  FF_CSV_URL?: string;
}
