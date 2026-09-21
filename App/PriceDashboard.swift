import SwiftUI

struct PriceDashboard: View {
    let store: PriceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 22) {
            HStack {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Market glance")
                        .font(.largeTitle.bold())
                    Text("ETH and Circle bStock in USD")
                        .foregroundStyle(.secondary)
                }
                Spacer()
                Button {
                    Task { await store.refresh() }
                } label: {
                    if store.isLoading {
                        ProgressView().controlSize(.small)
                    } else {
                        Image(systemName: "arrow.clockwise")
                    }
                }
                .buttonStyle(.bordered)
                .disabled(store.isLoading)
                .accessibilityLabel("Refresh prices")
            }

            if let snapshot = store.snapshot {
                HStack(spacing: 14) {
                    PriceCard(asset: snapshot.ethereum, color: .indigo)
                    PriceCard(asset: snapshot.crclb, color: .mint)
                }
                HStack(spacing: 14) {
                    SignalDetailCard(assessment: store.signal(for: "ETH"))
                    SignalDetailCard(assessment: store.signal(for: "CRCLB"))
                }
                HStack(spacing: 14) {
                    ForEach(["ETH", "CRCLB"], id: \.self) { symbol in
                        let point = store.turningPoint(for: symbol)
                        VStack(alignment: .leading, spacing: 4) {
                            TurningPointBadge(assessment: point)
                            Text(point.reason).font(.caption).foregroundStyle(.secondary)
                        }
                        .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
                Text("Updated \(PriceFormatters.updated(snapshot.fetchedAt)) · Data: Binance")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            } else if let errorMessage = store.errorMessage {
                ContentUnavailableView(
                    "Prices unavailable",
                    systemImage: "wifi.exclamationmark",
                    description: Text(errorMessage)
                )
            } else {
                ProgressView("Loading prices…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(24)
        .task { await store.refresh() }
    }
}

private struct PriceCard: View {
    let asset: AssetPrice
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack {
                Circle().fill(color.gradient).frame(width: 12, height: 12)
                Text(asset.symbol).font(.headline)
            }
            Text(PriceFormatters.usd(asset.price))
                .font(.system(.title, design: .rounded, weight: .semibold))
                .contentTransition(.numericText())
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(18)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 16))
    }
}
