import Foundation

actor MarketHistoryService {
    static let shared = MarketHistoryService()

    private let baseURL = "https://data-api.binance.vision/api/v3/klines"
    private let symbols = ["ETHUSDT", "CRCLBUSDT"]
    private let intervals = ["5m", "15m", "1h"]

    func turningPoints() async throws -> [String: TurningPointAssessment] {
        let endpoint = baseURL
        return try await withThrowingTaskGroup(of: (String, TurningPointAssessment).self) { group in
            for symbol in symbols {
                group.addTask {
                    let candles = try await Self.fetchCandles(baseURL: endpoint, symbol: symbol, interval: "15m")
                    let name = symbol == "ETHUSDT" ? "ETH" : "CRCLB"
                    return (name, TurningPointEngine.assess(symbol: name, candles: candles))
                }
            }
            var result: [String: TurningPointAssessment] = [:]
            for try await (name, assessment) in group { result[name] = assessment }
            return result
        }
    }

    func refreshSignals() async throws -> [String: SignalAssessment] {
        var updated: [String: [Candle]] = [:]
        let endpoint = baseURL

        try await withThrowingTaskGroup(of: (String, [Candle]).self) { group in
            for symbol in symbols {
                for interval in intervals {
                    group.addTask {
                        let candles = try await Self.fetchCandles(
                            baseURL: endpoint,
                            symbol: symbol,
                            interval: interval
                        )
                        return (Self.key(symbol: symbol, interval: interval), candles)
                    }
                }
            }

            for try await (key, candles) in group {
                updated[key] = try await LocalHistoryStore.shared.merge(candles, key: key)
            }
        }

        return Dictionary(uniqueKeysWithValues: symbols.map { symbol in
            let name = symbol == "ETHUSDT" ? "ETH" : "CRCLB"
            let assessment = SignalEngine.assess(
                symbol: name,
                fiveMinute: updated[Self.key(symbol: symbol, interval: "5m")] ?? [],
                fifteenMinute: updated[Self.key(symbol: symbol, interval: "15m")] ?? [],
                hourly: updated[Self.key(symbol: symbol, interval: "1h")] ?? []
            )
            return (name, assessment)
        })
    }

    private static func fetchCandles(
        baseURL: String,
        symbol: String,
        interval: String
    ) async throws -> [Candle] {
        var components = URLComponents(string: baseURL)!
        components.queryItems = [
            URLQueryItem(name: "symbol", value: symbol),
            URLQueryItem(name: "interval", value: interval),
            URLQueryItem(name: "limit", value: "200")
        ]

        var request = URLRequest(url: components.url!)
        request.timeoutInterval = 12
        request.cachePolicy = .reloadIgnoringLocalAndRemoteCacheData
        request.setValue("no-cache", forHTTPHeaderField: "Cache-Control")

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse,
              (200..<300).contains(http.statusCode) else {
            throw PriceError.invalidResponse
        }

        let rows = try JSONSerialization.jsonObject(with: data) as? [[Any]] ?? []
        let now = Date.now
        return rows.compactMap { row in
            guard row.count >= 7,
                  let openMilliseconds = row[0] as? Double,
                  let open = Double(row[1] as? String ?? ""),
                  let high = Double(row[2] as? String ?? ""),
                  let low = Double(row[3] as? String ?? ""),
                  let close = Double(row[4] as? String ?? ""),
                  let volume = Double(row[5] as? String ?? ""),
                  let closeMilliseconds = row[6] as? Double else {
                return nil
            }

            let closeTime = Date(timeIntervalSince1970: closeMilliseconds / 1_000)
            guard closeTime < now else { return nil }
            return Candle(
                symbol: symbol,
                interval: interval,
                openTime: Date(timeIntervalSince1970: openMilliseconds / 1_000),
                closeTime: closeTime,
                open: open,
                high: high,
                low: low,
                close: close,
                volume: volume
            )
        }
    }

    private static func key(symbol: String, interval: String) -> String {
        "\(symbol)|\(interval)"
    }
}
