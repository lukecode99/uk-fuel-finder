// Station facilities heuristics (FF-15). Brand-level defaults — a station's
// actual fit-out may differ, but these cover the common case for the pilot.
// Taxonomy: shop | coffee | food | toilet | car-wash | services
// 'services' = motorway services / full amenity stop.

const BRAND_MAP: Record<string, string[]> = {
  // Supermarket forecourts: always shop + food court + toilets.
  tesco: ['shop', 'food', 'toilet'],
  sainsburys: ['shop', 'food', 'toilet'],
  asda: ['shop', 'food', 'toilet'],
  morrisons: ['shop', 'food', 'toilet', 'car-wash'],
  waitrose: ['shop', 'food', 'toilet'],
  // Oil-company branded: shop + Costa partnership (most sites) + toilets.
  bp: ['shop', 'coffee', 'toilet'],
  shell: ['shop', 'coffee', 'toilet'],
  esso: ['shop', 'toilet'],
  texaco: ['shop', 'toilet'],
  gulf: ['shop'],
  jet: ['shop'],
  // Motorway services operators: full stop.
  moto: ['shop', 'coffee', 'food', 'toilet', 'services'],
  'extra msa': ['shop', 'coffee', 'food', 'toilet', 'services'],
  roadchef: ['shop', 'coffee', 'food', 'toilet', 'services'],
  welcome: ['shop', 'coffee', 'food', 'toilet', 'services'],
  // Independents / dealer groups: shop only as safe default.
  applegreen: ['shop', 'coffee', 'food', 'toilet'],
  sgn: ['shop'],
  rontec: ['shop'],
  mfg: ['shop'],
};

function normalize(brand: string): string {
  return brand.toLowerCase().replace(/['\s]+/g, '').replace("'", '');
}

// Loose match: 'Tesco Express' → 'tesco', 'BP Connect' → 'bp', etc.
function matchBrand(brand: string): string | null {
  const n = normalize(brand);
  for (const key of Object.keys(BRAND_MAP)) {
    if (n.startsWith(normalize(key)) || normalize(key).startsWith(n.slice(0, 4))) return key;
  }
  return null;
}

export function facilitiesForBrand(brand: string): string[] {
  const key = matchBrand(brand);
  return key ? [...BRAND_MAP[key]] : [];
}
