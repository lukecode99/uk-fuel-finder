// fuelfinder://station/<id> — sent by the home-screen widget. The station id
// is percent-encoded (ids contain a source prefix like "tesco:...").
//
// Pure so tests can bundle it without React Native. Depending on the URL
// shape, "station" arrives as the host (fuelfinder://station/x) or the first
// path segment (fuelfinder:///station/x) — accept both.
export function parseStationDeepLink(url: string): string | null {
  const m = /^fuelfinder:\/\/+station\/(.+)$/.exec(url.trim());
  if (!m) return null;
  try {
    const id = decodeURIComponent(m[1]);
    return id.length > 0 ? id : null;
  } catch {
    return null; // malformed percent-encoding
  }
}
