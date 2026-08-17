import Foundation

struct AssetPrice: Codable, Hashable, Sendable {
    let symbol: String
    let price: Double
    let timestamp: Date
}

struct PriceSnapshot: Codable, Hashable, Sendable {
    let ethereum: AssetPrice
    let crclb: AssetPrice
    let fetchedAt: Date

    static let preview = PriceSnapshot(
        ethereum: AssetPrice(symbol: "ETH", price: 3_421.68, timestamp: .now),
        crclb: AssetPrice(symbol: "CRCLB", price: 71.79, timestamp: .now),
        fetchedAt: .now
    )
}

