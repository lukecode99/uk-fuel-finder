// Affiliate layer (FF-7), same pattern as Colour Detective's referral
// module: a single config object with everything off, pure link builders,
// and a capped local link-out log. Nothing is fabricated — with no ids set
// (the shipped state) affiliateLinks() is empty and no UI renders at all.
//
// Pure module: no React Native or storage imports, so tests can bundle it.

export interface AffiliateConfig {
  awinAffId: string; // Awin publisher id, once approved
  breakdownMid: string; // Awin merchant id — breakdown cover partner
  breakdownDest: string; // partner landing URL routed through Awin
  insuranceMid: string; // Awin merchant id — car insurance comparison
  insuranceDest: string;
}

// Live defaults: everything off until partner approvals land.
export const AFFILIATE_CONFIG: AffiliateConfig = {
  awinAffId: '',
  breakdownMid: '',
  breakdownDest: '',
  insuranceMid: '',
  insuranceDest: '',
};

export type AffiliateKey = 'breakdown' | 'insurance';

export interface AffiliateLink {
  key: AffiliateKey;
  label: string; // section row label, e.g. "Breakdown cover"
  cta: string; // button copy
  url: string;
  via: 'awin';
}

export function awinDeepLink(dest: string, mid: string, affId: string): string {
  return `https://www.awin1.com/cread.php?awinmid=${encodeURIComponent(mid)}&awinaffid=${encodeURIComponent(affId)}&ued=${encodeURIComponent(dest)}`;
}

// Only offers whose ids are fully configured are returned; a partially
// filled config (mid but no publisher id, etc.) renders nothing rather
// than a broken link.
export function affiliateLinks(config: AffiliateConfig = AFFILIATE_CONFIG): AffiliateLink[] {
  const links: AffiliateLink[] = [];
  if (config.awinAffId && config.breakdownMid && config.breakdownDest) {
    links.push({
      key: 'breakdown',
      label: 'Breakdown cover',
      cta: 'Compare breakdown cover',
      url: awinDeepLink(config.breakdownDest, config.breakdownMid, config.awinAffId),
      via: 'awin',
    });
  }
  if (config.awinAffId && config.insuranceMid && config.insuranceDest) {
    links.push({
      key: 'insurance',
      label: 'Car insurance',
      cta: 'Compare car insurance',
      url: awinDeepLink(config.insuranceDest, config.insuranceMid, config.awinAffId),
      via: 'awin',
    });
  }
  return links;
}

// --- Link-out log (entries newest-first, capped) ---------------------------

export interface LinkOutEntry {
  timestamp: number;
  key: AffiliateKey;
  stationId: string | null; // station sheet the tap came from, if any
  url: string;
}

export const MAX_LINKOUTS = 200;

export function appendLinkOut(
  log: LinkOutEntry[],
  entry: LinkOutEntry,
  max: number = MAX_LINKOUTS,
): LinkOutEntry[] {
  return [entry, ...log].slice(0, max);
}
