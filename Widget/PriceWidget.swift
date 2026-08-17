import SwiftUI
import WidgetKit

struct PriceEntry: TimelineEntry {
    let date: Date
    let snapshot: PriceSnapshot
    let isStale: Bool
}

struct PriceProvider: TimelineProvider {
    func placeholder(in context: Context) -> PriceEntry {
        PriceEntry(date: .now, snapshot: .preview, isStale: false)
    }

    func getSnapshot(in context: Context, completion: @escaping (PriceEntry) -> Void) {
        if context.isPreview {
            completion(placeholder(in: context))
            return
        }
        Task { completion(await loadEntry()) }
    }

    func getTimeline(in context: Context, completion: @escaping (Timeline<PriceEntry>) -> Void) {
        Task {
            let entry = await loadEntry()
            let nextRefresh = Calendar.current.date(byAdding: .minute, value: 15, to: .now)!
            completion(Timeline(entries: [entry], policy: .after(nextRefresh)))
        }
    }

    private func loadEntry() async -> PriceEntry {
        do {
            let snapshot = try await PriceService.shared.fetch()
            Cache.save(snapshot)
            return PriceEntry(date: .now, snapshot: snapshot, isStale: false)
        } catch {
            return PriceEntry(
                date: .now,
                snapshot: Cache.load() ?? .preview,
                isStale: true
            )
        }
    }
}

struct PriceWidgetView: View {
    @Environment(\.widgetFamily) private var family
    let entry: PriceEntry

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("MARKETS")
                    .font(.caption2.weight(.bold))
                    .tracking(1.2)
                    .foregroundStyle(.secondary)
                Spacer()
                if entry.isStale {
                    Image(systemName: "wifi.exclamationmark")
                        .font(.caption)
                        .foregroundStyle(.orange)
                        .accessibilityLabel("Showing cached prices")
                }
            }

            if family == .systemSmall {
                CompactAssetRow(asset: entry.snapshot.ethereum, color: .indigo)
                CompactAssetRow(asset: entry.snapshot.crclb, color: .mint)
            } else {
                HStack(spacing: 20) {
                    AssetColumn(asset: entry.snapshot.ethereum, color: .indigo)
                    Divider()
                    AssetColumn(asset: entry.snapshot.crclb, color: .mint)
                }
            }

            Spacer(minLength: 0)
            Text("Updated \(PriceFormatters.updated(entry.snapshot.fetchedAt))")
                .font(.caption2)
                .foregroundStyle(.tertiary)
        }
        .containerBackground(for: .widget) {
            LinearGradient(
                colors: [Color(nsColor: .windowBackgroundColor), .indigo.opacity(0.11)],
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )
        }
    }
}

private struct CompactAssetRow: View {
    let asset: AssetPrice
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 2) {
            HStack(spacing: 5) {
                Circle().fill(color.gradient).frame(width: 7, height: 7)
                Text(asset.symbol).font(.caption.weight(.semibold))
            }
            Text(PriceFormatters.usd(asset.price))
                .font(.system(.title3, design: .rounded, weight: .bold))
                .minimumScaleFactor(0.75)
                .lineLimit(1)
        }
    }
}

private struct AssetColumn: View {
    let asset: AssetPrice
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 6) {
                Circle().fill(color.gradient).frame(width: 9, height: 9)
                Text(asset.symbol).font(.headline)
            }
            Text(PriceFormatters.usd(asset.price))
                .font(.system(.title2, design: .rounded, weight: .bold))
                .minimumScaleFactor(0.7)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

@main
struct PriceWidget: Widget {
    let kind = "PriceWidget"

    var body: some WidgetConfiguration {
        StaticConfiguration(kind: kind, provider: PriceProvider()) { entry in
            PriceWidgetView(entry: entry)
        }
        .configurationDisplayName("ETH & CRCLB")
        .description("Current ETH and Circle bStock prices in USD.")
        .supportedFamilies([.systemSmall, .systemMedium])
    }
}

private enum Cache {
    private static let key = "lastPriceSnapshot"

    static func save(_ snapshot: PriceSnapshot) {
        guard let data = try? JSONEncoder().encode(snapshot) else { return }
        UserDefaults.standard.set(data, forKey: key)
    }

    static func load() -> PriceSnapshot? {
        guard let data = UserDefaults.standard.data(forKey: key) else { return nil }
        return try? JSONDecoder().decode(PriceSnapshot.self, from: data)
    }
}

#Preview(as: .systemSmall) {
    PriceWidget()
} timeline: {
    PriceEntry(date: .now, snapshot: .preview, isStale: false)
}

