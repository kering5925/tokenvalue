import Foundation

actor PriceService {
    static let shared = PriceService()

    private let endpoint = URL(
        string: "https://data-api.binance.vision/api/v3/ticker/price?symbols=%5B%22ETHUSDT%22,%22CRCLBUSDT%22%5D"
    )!

    func fetch() async throws -> PriceSnapshot {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw PriceError.invalidResponse
        }

        let tickers = try JSONDecoder().decode([Ticker].self, from: data)
        let prices = Dictionary(uniqueKeysWithValues: tickers.map { ($0.symbol, $0) })
        guard let ethereum = prices[Keys.ethereum],
              let crclb = prices[Keys.crclb] else {
            throw PriceError.missingAsset
        }

        let fetchedAt = Date.now

        return PriceSnapshot(
            ethereum: try ethereum.asset(named: "ETH", at: fetchedAt),
            crclb: try crclb.asset(named: "CRCLB", at: fetchedAt),
            fetchedAt: fetchedAt
        )
    }
}

private extension PriceService {
    enum Keys {
        static let ethereum = "ETHUSDT"
        static let crclb = "CRCLBUSDT"
    }

    struct Ticker: Decodable {
        let symbol: String
        let price: String

        func asset(named name: String, at timestamp: Date) throws -> AssetPrice {
            guard let value = Double(price) else {
                throw PriceError.invalidResponse
            }
            return AssetPrice(symbol: name, price: value, timestamp: timestamp)
        }
    }
}

enum PriceError: LocalizedError {
    case invalidResponse
    case missingAsset

    var errorDescription: String? {
        switch self {
        case .invalidResponse: "The price server returned an invalid response."
        case .missingAsset: "A requested asset was missing from the response."
        }
    }
}
