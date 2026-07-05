import AppIntents
import CoreLocation
import SwiftUI
import WidgetKit

// MARK: - Fuel choice (widget edit menu)
// Codes and labels mirror app/src/fuel.ts.

enum FuelChoice: String, AppEnum {
  case e10, e5, b7, sdv

  var code: String {
    switch self {
    case .e10: return "E10"
    case .e5: return "E5"
    case .b7: return "B7"
    case .sdv: return "SDV"
    }
  }

  var label: String {
    switch self {
    case .e10: return "Petrol (E10)"
    case .e5: return "Super (E5)"
    case .b7: return "Diesel (B7)"
    case .sdv: return "Premium diesel"
    }
  }

  static var typeDisplayRepresentation = TypeDisplayRepresentation(name: "Fuel type")
  static var caseDisplayRepresentations: [FuelChoice: DisplayRepresentation] = [
    .e10: "Petrol (E10)",
    .e5: "Super (E5)",
    .b7: "Diesel (B7)",
    .sdv: "Premium diesel",
  ]
}

struct FuelConfigIntent: WidgetConfigurationIntent {
  static var title: LocalizedStringResource = "Fuel type"
  static var description = IntentDescription("Choose which fuel price to track.")

  @Parameter(title: "Fuel", default: .e10)
  var fuel: FuelChoice
}

// MARK: - Data

struct CheapStation: Identifiable {
  let id: String
  let brand: String
  let postcode: String
  let price: Double // pence per litre
  let distanceMiles: Double
  let updatedAt: Date?

  var deepLink: URL? {
    let encoded =
      id.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? id
    return URL(string: "fuelfinder://station/\(encoded)")
  }
}

struct FuelEntry: TimelineEntry {
  let date: Date
  let fuel: FuelChoice
  let stations: [CheapStation]
  let message: String? // set when there's nothing to show, explains why

  static func placeholder(_ fuel: FuelChoice) -> FuelEntry {
    FuelEntry(
      date: Date(),
      fuel: fuel,
      stations: [
        CheapStation(
          id: "a", brand: "Tesco", postcode: "SW1A 1AA", price: 138.9,
          distanceMiles: 0.8, updatedAt: Date()),
        CheapStation(
          id: "b", brand: "Asda", postcode: "SW1V 2BB", price: 139.7,
          distanceMiles: 1.4, updatedAt: Date()),
        CheapStation(
          id: "c", brand: "Shell", postcode: "SW8 3CC", price: 141.9,
          distanceMiles: 2.1, updatedAt: Date()),
      ],
      message: nil)
  }
}

// GeoJSON shape returned by /stations — matches app/src/api.ts.
private struct StationsResponse: Decodable {
  struct Feature: Decodable {
    struct Geometry: Decodable { let coordinates: [Double] }
    struct Props: Decodable {
      let id: String
      let brand: String
      let postcode: String
      let prices: [String: Double?]
      let priceUpdatedAt: String?
    }
    let geometry: Geometry
    let properties: Props
  }
  let features: [Feature]
}

enum FuelAPI {
  static let base = "https://uk-fuel-finder.nanoluke521.workers.dev"
  // Same radius as the app's "Cheapest within 5 mi" bar (MainScreen NEARBY_RADIUS_MILES).
  static let radiusMiles = 5.0

  // Selection mirrors the app exactly: bboxAround(loc, 5mi) fetch, drop
  // stations without a price for the fuel or beyond 5 mi, sort price asc
  // with distance as the tiebreak (app/src/sort.ts), take three.
  static func cheapestThree(around loc: CLLocation, fuel: String) async throws -> [CheapStation] {
    let lat = loc.coordinate.latitude
    let lon = loc.coordinate.longitude
    let dLat = radiusMiles / 69.0
    let dLon = radiusMiles / (69.0 * cos(lat * .pi / 180))
    let bbox = "\(lon - dLon),\(lat - dLat),\(lon + dLon),\(lat + dLat)"
    guard let url = URL(string: "\(base)/stations?bbox=\(bbox)") else { return [] }

    let (data, _) = try await URLSession.shared.data(from: url)
    let decoded = try JSONDecoder().decode(StationsResponse.self, from: data)

    let isoFrac = ISO8601DateFormatter()
    isoFrac.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    let iso = ISO8601DateFormatter()

    return
      decoded.features
      .compactMap { f -> CheapStation? in
        guard let price = f.properties.prices[fuel] ?? nil,
          f.geometry.coordinates.count == 2
        else { return nil }
        let sLoc = CLLocation(
          latitude: f.geometry.coordinates[1], longitude: f.geometry.coordinates[0])
        let miles = loc.distance(from: sLoc) / 1609.344
        guard miles <= radiusMiles else { return nil }
        let ts = f.properties.priceUpdatedAt
        let updated = ts.flatMap { isoFrac.date(from: $0) ?? iso.date(from: $0) }
        return CheapStation(
          id: f.properties.id, brand: f.properties.brand, postcode: f.properties.postcode,
          price: price, distanceMiles: miles, updatedAt: updated)
      }
      .sorted { a, b in
        a.price != b.price ? a.price < b.price : a.distanceMiles < b.distanceMiles
      }
      .prefix(3)
      .map { $0 }
  }
}

// Last-known location. The main app holds when-in-use permission and
// NSWidgetWantsLocation in Info.plist extends it to this extension —
// no prompt can be shown from a widget, so unauthorized means "open the app".
private func lastKnownLocation() -> CLLocation? {
  let manager = CLLocationManager()
  switch manager.authorizationStatus {
  case .authorizedWhenInUse, .authorizedAlways:
    return manager.location
  default:
    return nil
  }
}

// MARK: - Timeline

struct Provider: AppIntentTimelineProvider {
  func placeholder(in context: Context) -> FuelEntry {
    .placeholder(.e10)
  }

  func snapshot(for configuration: FuelConfigIntent, in context: Context) async -> FuelEntry {
    if context.isPreview { return .placeholder(configuration.fuel) }
    return await load(configuration)
  }

  func timeline(for configuration: FuelConfigIntent, in context: Context) async -> Timeline<
    FuelEntry
  > {
    let entry = await load(configuration)
    // Prices ingest every 10 min server-side; 30 min here keeps well inside
    // the WidgetKit refresh budget while staying at most 3 crons stale.
    return Timeline(entries: [entry], policy: .after(Date().addingTimeInterval(30 * 60)))
  }

  private func load(_ config: FuelConfigIntent) async -> FuelEntry {
    guard let loc = lastKnownLocation() else {
      return FuelEntry(
        date: Date(), fuel: config.fuel, stations: [],
        message: "Open Fuel Finder once to share your location.")
    }
    do {
      let stations = try await FuelAPI.cheapestThree(around: loc, fuel: config.fuel.code)
      if stations.isEmpty {
        return FuelEntry(
          date: Date(), fuel: config.fuel, stations: [],
          message: "No \(config.fuel.label) prices within 5 mi.")
      }
      return FuelEntry(date: Date(), fuel: config.fuel, stations: stations, message: nil)
    } catch {
      return FuelEntry(
        date: Date(), fuel: config.fuel, stations: [],
        message: "Couldn’t reach the price service.")
    }
  }
}

// MARK: - Formatting

private func priceText(_ pence: Double) -> String {
  String(format: "%.1fp", pence)
}

private func distanceText(_ miles: Double) -> String {
  miles < 10 ? String(format: "%.1f mi", miles) : String(format: "%.0f mi", miles)
}

private func ageText(_ date: Date?, now: Date) -> String {
  guard let date else { return "—" }
  let mins = max(0, Int(now.timeIntervalSince(date) / 60))
  if mins < 60 { return "\(mins)m" }
  let hours = mins / 60
  if hours < 24 { return "\(hours)h" }
  return "\(hours / 24)d"
}

// MARK: - Views

struct StationRow: View {
  let station: CheapStation
  let now: Date

  var body: some View {
    HStack(spacing: 8) {
      VStack(alignment: .leading, spacing: 1) {
        Text(station.brand)
          .font(.system(size: 13, weight: .semibold))
          .foregroundColor(Color("widgetText"))
          .lineLimit(1)
        Text("\(distanceText(station.distanceMiles)) · \(ageText(station.updatedAt, now: now))")
          .font(.system(size: 10))
          .foregroundColor(Color("widgetTextDim"))
      }
      Spacer(minLength: 4)
      Text(priceText(station.price))
        .font(.system(size: 15, weight: .bold).monospacedDigit())
        .foregroundColor(Color("widgetAccent"))
    }
  }
}

struct FuelWidgetView: View {
  @Environment(\.widgetFamily) var family
  let entry: FuelEntry

  var body: some View {
    if let message = entry.message {
      VStack(spacing: 6) {
        Text("Fuel Finder")
          .font(.system(size: 11, weight: .bold))
          .foregroundColor(Color("widgetAccent"))
        Text(message)
          .font(.system(size: 11))
          .foregroundColor(Color("widgetTextDim"))
          .multilineTextAlignment(.center)
      }
    } else if family == .systemSmall {
      small
    } else {
      medium
    }
  }

  // Cheapest single station; whole widget deep-links to it.
  var small: some View {
    let cheapest = entry.stations[0]
    return VStack(alignment: .leading, spacing: 3) {
      Text("CHEAPEST \(entry.fuel.code)")
        .font(.system(size: 9, weight: .heavy))
        .foregroundColor(Color("widgetAccent"))
      Spacer(minLength: 0)
      Text(priceText(cheapest.price))
        .font(.system(size: 26, weight: .heavy).monospacedDigit())
        .foregroundColor(Color("widgetText"))
      Text(cheapest.brand)
        .font(.system(size: 12, weight: .semibold))
        .foregroundColor(Color("widgetText"))
        .lineLimit(1)
      Text("\(distanceText(cheapest.distanceMiles)) · \(ageText(cheapest.updatedAt, now: entry.date)) ago")
        .font(.system(size: 10))
        .foregroundColor(Color("widgetTextDim"))
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .leading)
    .widgetURL(cheapest.deepLink)
  }

  // Three rows, each its own deep link.
  var medium: some View {
    VStack(alignment: .leading, spacing: 5) {
      Text("\(entry.fuel.label) — cheapest near you")
        .font(.system(size: 10, weight: .heavy))
        .foregroundColor(Color("widgetAccent"))
      ForEach(entry.stations) { station in
        if let url = station.deepLink {
          Link(destination: url) { StationRow(station: station, now: entry.date) }
        } else {
          StationRow(station: station, now: entry.date)
        }
      }
      Spacer(minLength: 0)
    }
    .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
  }
}

// MARK: - Widget

struct FuelWidget: Widget {
  let kind = "FuelWidget"

  var body: some WidgetConfiguration {
    AppIntentConfiguration(kind: kind, intent: FuelConfigIntent.self, provider: Provider()) {
      entry in
      FuelWidgetView(entry: entry)
        .containerBackground(Color("widgetBg"), for: .widget)
    }
    .configurationDisplayName("Cheapest fuel nearby")
    .description("The three cheapest stations within 5 miles for your fuel.")
    .supportedFamilies([.systemSmall, .systemMedium])
  }
}

@main
struct FuelWidgetBundle: WidgetBundle {
  var body: some Widget {
    FuelWidget()
  }
}
