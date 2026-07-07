export type FuelCode = 'E10' | 'E5' | 'B7' | 'SDV';

export interface Station {
  id: string;
  brand: string;
  address: string;
  postcode: string;
  lat: number;
  lon: number;
  prices: Partial<Record<FuelCode, number>>;
  priceUpdatedAt: string; // ISO timestamp — every price surface must show its age
  source: string;
  facilities?: string[]; // taxonomy: shop|coffee|food|toilet|car-wash|services (FF-15)
}

export type SortMode = 'price' | 'distance';

export interface LatLon {
  lat: number;
  lon: number;
}

// Mirror of react-native-maps' Region so shared code never imports the
// native module (which has no web build).
export interface MapRegion {
  latitude: number;
  longitude: number;
  latitudeDelta: number;
  longitudeDelta: number;
}
