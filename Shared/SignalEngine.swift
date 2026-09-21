import Foundation

enum SignalEngine {
    private static let roundTripCost = 0.005
    private static let outcomeBars = 8
    private static let minimumSamples = 20

    static func assess(symbol: String, fiveMinute: [Candle], fifteenMinute: [Candle], hourly: [Candle]) -> SignalAssessment {
        guard fiveMinute.count >= 50, fifteenMinute.count >= 50, hourly.count >= 50 else {
            return .loading(symbol: symbol)
        }

        let series = makeFeatureSeries(fiveMinute: fiveMinute, fifteenMinute: fifteenMinute, hourly: hourly)
        guard let latest = series.last else { return .loading(symbol: symbol) }
        var reasons = latest.reasons
        let signal = latest.signal

        if signal != .neutral {
            let quality = historicalQuality(for: signal, in: series)
            let winRate = Int((quality.winRate * 100).rounded())
            if quality.samples < minimumSamples {
                reasons.insert("历史样本 \(quality.samples)/\(minimumSamples)", at: 0)
            } else {
                reasons.insert("历史命中率 \(winRate)%（\(quality.samples)笔）", at: 0)
            }
        }

        return SignalAssessment(
            symbol: symbol,
            signal: signal,
            score: latest.score,
            reasons: Array(reasons.prefix(3)),
            calculatedAt: .now
        )
    }

    private struct FeaturePoint {
        let close: Double
        let signal: TradeSignal
        let score: Int
        let reasons: [String]
    }

    private struct SignalQuality {
        let samples: Int
        let winRate: Double
        let averageNetReturn: Double
    }

    private static func makeFeatureSeries(
        fiveMinute: [Candle],
        fifteenMinute: [Candle],
        hourly: [Candle]
    ) -> [FeaturePoint] {
        let candles5m = fiveMinute.sorted { $0.closeTime < $1.closeTime }
        let candles15m = fifteenMinute.sorted { $0.closeTime < $1.closeTime }
        let candles1h = hourly.sorted { $0.closeTime < $1.closeTime }
        let closes15m = candles15m.map(\.close)
        let ema9_5m = emaSeries(candles5m.map(\.close), period: 9)
        let ema20_15m = emaSeries(closes15m, period: 20)
        let ema20_1h = emaSeries(candles1h.map(\.close), period: 20)
        let ema50_1h = emaSeries(candles1h.map(\.close), period: 50)
        var index5m = -1
        var index1h = -1
        var points: [FeaturePoint] = []

        for index15m in candles15m.indices {
            let candle = candles15m[index15m]
            while index5m + 1 < candles5m.count, candles5m[index5m + 1].closeTime <= candle.closeTime { index5m += 1 }
            while index1h + 1 < candles1h.count, candles1h[index1h + 1].closeTime <= candle.closeTime { index1h += 1 }
            guard index15m >= 49, index5m >= 49, index1h >= 49 else { continue }

            let rsiValue = rsi(closes15m, endingAt: index15m, period: 14)
            let atrPercent = atr(candles15m, endingAt: index15m, period: 14) / candle.close * 100
            let priorVolumes = candles15m[(index15m - 20)..<index15m].map(\.volume)
            let volumeConfirmed = candle.volume > median(priorVolumes)
            let trendUp = ema20_1h[index1h] > ema50_1h[index1h]
            let aboveEMA20 = candle.close > ema20_15m[index15m]
            var score = 0
            var reasons: [String] = []

            if trendUp { score += 30; reasons.append("1h 多头趋势") }
            else { reasons.append("1h 趋势偏弱") }
            if aboveEMA20 { score += 20; reasons.append("15m 站上 EMA20") }
            else { reasons.append("15m 跌破 EMA20") }
            if (50...68).contains(rsiValue) { score += 15; reasons.append("RSI 动能健康") }
            else if rsiValue < 42 { reasons.append("RSI 偏弱") }
            else if rsiValue > 72 { reasons.append("RSI 偏热") }
            if volumeConfirmed { score += 15; reasons.append("成交量确认") }
            if candles5m[index5m].close > ema9_5m[index5m] { score += 10; reasons.append("5m 动量向上") }
            if (0.15...4.0).contains(atrPercent) { score += 10 }
            else if atrPercent > 4.0 { reasons.append("波动率过高") }

            let signal: TradeSignal
            if score >= 70 { signal = .buy }
            else if score <= 25 && !aboveEMA20 && !trendUp { signal = .sell }
            else { signal = .neutral }
            points.append(FeaturePoint(close: candle.close, signal: signal, score: score, reasons: reasons))
        }
        return points
    }

    private static func historicalQuality(for signal: TradeSignal, in series: [FeaturePoint]) -> SignalQuality {
        guard series.count > outcomeBars else { return SignalQuality(samples: 0, winRate: 0, averageNetReturn: 0) }
        var returns: [Double] = []
        var nextAllowedIndex = 0
        for index in 0..<(series.count - outcomeBars) {
            guard index >= nextAllowedIndex, series[index].signal == signal else { continue }
            let entry = series[index].close
            let exit = series[index + outcomeBars].close
            let netReturn = signal == .buy
                ? exit / entry - 1 - roundTripCost
                : entry / exit - 1 - roundTripCost
            returns.append(netReturn)
            nextAllowedIndex = index + outcomeBars
        }
        guard !returns.isEmpty else { return SignalQuality(samples: 0, winRate: 0, averageNetReturn: 0) }
        return SignalQuality(
            samples: returns.count,
            winRate: Double(returns.filter { $0 > 0 }.count) / Double(returns.count),
            averageNetReturn: returns.reduce(0, +) / Double(returns.count)
        )
    }

    private static func emaSeries(_ values: [Double], period: Int) -> [Double] {
        guard let first = values.first else { return [] }
        let multiplier = 2.0 / Double(period + 1)
        var result = [first]
        for value in values.dropFirst() { result.append(value * multiplier + result.last! * (1 - multiplier)) }
        return result
    }

    private static func rsi(_ values: [Double], endingAt index: Int, period: Int) -> Double {
        var gains = 0.0
        var losses = 0.0
        for current in (index - period + 1)...index {
            let change = values[current] - values[current - 1]
            gains += max(change, 0)
            losses += max(-change, 0)
        }
        guard losses > 0 else { return 100 }
        return 100 - (100 / (1 + gains / losses))
    }

    private static func atr(_ candles: [Candle], endingAt index: Int, period: Int) -> Double {
        var total = 0.0
        for current in (index - period + 1)...index {
            let candle = candles[current]
            let previousClose = candles[current - 1].close
            total += max(candle.high - candle.low, abs(candle.high - previousClose), abs(candle.low - previousClose))
        }
        return total / Double(period)
    }

    private static func median(_ values: [Double]) -> Double {
        guard !values.isEmpty else { return 0 }
        let sorted = values.sorted()
        let middle = sorted.count / 2
        return sorted.count.isMultiple(of: 2) ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle]
    }
}
