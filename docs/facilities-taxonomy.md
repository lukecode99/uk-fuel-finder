# Station Facilities Taxonomy (FF-15)

## Taxonomy

Station facilities are tagged using six fixed keys:

| Key | Display label | Description |
|-----|--------------|-------------|
| `shop` | Shop | On-site retail shop |
| `coffee` | Coffee | Hot drinks (Costa partnership or own-brand) |
| `food` | Food | Hot food or deli counter |
| `toilet` | Toilets | Customer toilet facilities |
| `car-wash` | Car Wash | Automated or jet-wash bay |
| `services` | Services | Full motorway services stop |

## Brand map

Facilities are inferred from the station's brand. These are brand-level defaults covering the common case; individual sites may vary.

| Brand | Facilities |
|-------|-----------|
| Tesco | shop, food, toilet |
| Sainsbury's | shop, food, toilet |
| Asda | shop, food, toilet |
| Morrisons | shop, food, toilet, car-wash |
| Waitrose | shop, food, toilet |
| BP | shop, coffee, toilet |
| Shell | shop, coffee, toilet |
| Esso | shop, toilet |
| Texaco | shop, toilet |
| Gulf | shop |
| Jet | shop |
| Moto | shop, coffee, food, toilet, services |
| Extra MSA | shop, coffee, food, toilet, services |
| RoadChef | shop, coffee, food, toilet, services |
| Welcome Break | shop, coffee, food, toilet, services |
| Applegreen | shop, coffee, food, toilet |
| SGN | shop |
| Rontec | shop |
| MFG | shop |

Matching is case-insensitive and prefix-based (`"Tesco Express"` → `tesco`, `"BP Connect"` → `bp`). Unrecognised brands return an empty array and no chips are shown.

## Pilot scope

**This implementation is intentionally brand-wide UK** — the brand map applies to all matched stations regardless of location. There is no geographic bounding box. Brand-level defaults are the appropriate granularity for launch; a per-station override layer can be added later if facility data becomes available from the price feed.

## Implementation

`src/facilities.ts` — `facilitiesForBrand(brand: string): string[]`  
`app/src/components/StationSheet.tsx` — renders chips from `station.facilities`  
`app/src/types.ts` — `Station.facilities?: string[]`
