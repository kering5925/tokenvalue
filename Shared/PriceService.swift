import Foundation

actor PriceService {
    static let shared = PriceService()

    private let endpoint = URL(
        string: "https://coins.llama.fi/prices/current/coingecko:ethereum,bsc:0x80f3d493ebce97e343c53d29a137942416b4ffc0"
    )!

    func fetch() async throws -> PriceSnapshot {
        var request = URLRequest(url: endpoint)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadRevalidatingCacheData

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            throw PriceError.invalidResponse
        }

        let payload = try JSONDecoder().decode(Response.self, from: data)
        guard let ethereum = payload.coins[Keys.ethereum],
              let crclb = payload.coins[Keys.crclb] else {
            throw PriceError.missingAsset
        }

        return PriceSnapshot(
            ethereum: ethereum.asset,
            crclb: crclb.asset,
            fetchedAt: .now
        )
    }
}

private extension PriceService {
    enum Keys {
        static let ethereum = "coingecko:ethereum"
        static let crclb = "bsc:0x80f3d493ebce97e343c53d29a137942416b4ffc0"
    }

    struct Response: Decodable {
        let coins: [String: Coin]
    }

    struct Coin: Decodable {
        let price: Double
        let symbol: String
        let timestamp: TimeInterval

        var asset: AssetPrice {
            AssetPrice(
                symbol: symbol.uppercased(),
                price: price,
                timestamp: Date(timeIntervalSince1970: timestamp)
            )
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

