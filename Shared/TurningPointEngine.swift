import Foundation

enum TurningPointKind: String, Codable, Sendable {
    case bottom = "筑底观察"
    case top = "高点警戒"
    case none = "暂无拐点"
    case unavailable = "信号不可用"
}

struct TurningPointAssessment: Sendable {
    let symbol: String
    let kind: TurningPointKind
    let reason: String
    let candleTime: Date?

    static func unavailable(symbol: String, reason: String) -> Self {
        Self(symbol: symbol, kind: .unavailable, reason: reason, candleTime: nil)
    }
}

enum TurningPointEngine {
    static func assess(symbol: String, candles: [Candle], now: Date = .now) -> TurningPointAssessment {
        guard candles.count >= 35, let current = candles.last,
              now.timeIntervalSince(current.closeTime) >= 0,
              now.timeIntervalSince(current.closeTime) < 30 * 60 else {
            return .unavailable(symbol: symbol, reason: "15分钟K线不足或过期")
        }
        let previous = candles[candles.count - 2]
        let history = candles[(candles.count - 21)..<(candles.count - 1)]
        let range = current.high - current.low
        guard range > 0, current.close > 0 else {
            return .unavailable(symbol: symbol, reason: "K线数据异常")
        }
        let medianVolume = median(history.map(\.volume))
        let activeVolume = medianVolume > 0 && current.volume >= medianVolume * 1.2
        let previousRSI = rsi(candles, endingAt: candles.count - 2)
        let currentRSI = rsi(candles, endingAt: candles.count - 1)
        let priorLow = history.map(\.low).min()!
        let priorHigh = history.map(\.high).max()!

        if activeVolume && current.low <= priorLow * 1.003
            && (current.close - current.low) / range >= 0.65
            && current.close > current.open && current.close > previous.close
            && previousRSI <= 42 && currentRSI > previousRSI {
            return Self.result(symbol, .bottom, "试探近期低位后收回 · 动能回升 · 放量", current.closeTime)
        }
        if activeVolume && current.high >= priorHigh * 0.997
            && (current.high - current.close) / range >= 0.65
            && current.close < current.open && current.close < previous.close
            && previousRSI >= 58 && currentRSI < previousRSI {
            return Self.result(symbol, .top, "试探近期高位后回落 · 动能转弱 · 放量", current.closeTime)
        }
        return Self.result(symbol, .none, "当前没有满足观察条件", current.closeTime)
    }

    private static func result(_ symbol: String, _ kind: TurningPointKind, _ reason: String, _ time: Date) -> TurningPointAssessment {
        TurningPointAssessment(symbol: symbol, kind: kind, reason: reason, candleTime: time)
    }

    private static func rsi(_ candles: [Candle], endingAt index: Int) -> Double {
        var gains = 0.0
        var losses = 0.0
        for i in (index - 13)...index {
            let change = candles[i].close - candles[i - 1].close
            gains += max(change, 0)
            losses += max(-change, 0)
        }
        return losses == 0 ? 100 : 100 - 100 / (1 + gains / losses)
    }

    private static func median(_ values: [Double]) -> Double {
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return (sorted[middle - 1] + sorted[middle]) / 2
    }
}
