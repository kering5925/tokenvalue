import Foundation

struct Candle: Codable, Hashable, Sendable {
    let symbol: String
    let interval: String
    let openTime: Date
    let closeTime: Date
    let open: Double
    let high: Double
    let low: Double
    let close: Double
    let volume: Double
}

enum TradeSignal: String, Codable, Sendable {
    case buy = "买入观察"
    case sell = "卖出观察"
    case neutral = "观望"
    case paused = "策略已停用"
    case unavailable = "信号不可用"
}

struct SignalAssessment: Codable, Hashable, Sendable {
    let symbol: String
    let signal: TradeSignal
    let score: Int
    let reasons: [String]
    let calculatedAt: Date

    static func loading(symbol: String) -> SignalAssessment {
        SignalAssessment(
            symbol: symbol,
            signal: .neutral,
            score: 50,
            reasons: ["正在积累 K 线"],
            calculatedAt: .now
        )
    }
}
