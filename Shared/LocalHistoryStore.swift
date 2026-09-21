import Foundation

actor LocalHistoryStore {
    static let shared = LocalHistoryStore()

    private let fileURL: URL
    private var series: [String: [Candle]]

    private init() {
        let support = FileManager.default.urls(
            for: .applicationSupportDirectory,
            in: .userDomainMask
        ).first!
        let directory = support.appendingPathComponent("ETHPriceWidget", isDirectory: true)
        try? FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        fileURL = directory.appendingPathComponent("market-history.json")

        if let data = try? Data(contentsOf: fileURL),
           let decoded = try? JSONDecoder().decode([String: [Candle]].self, from: data) {
            series = decoded
        } else {
            series = [:]
        }
    }

    func merge(_ candles: [Candle], key: String) throws -> [Candle] {
        var byTime = Dictionary(
            uniqueKeysWithValues: (series[key] ?? []).map { ($0.openTime, $0) }
        )
        for candle in candles {
            byTime[candle.openTime] = candle
        }

        let merged = Array(
            byTime.values.sorted { $0.openTime < $1.openTime }.suffix(2_000)
        )
        series[key] = merged
        try persist()
        return merged
    }

    private func persist() throws {
        let data = try JSONEncoder().encode(series)
        try data.write(to: fileURL, options: .atomic)
    }
}
