import Foundation

private struct CloudSignalResponse: Decodable {
    let strategy: String?
    let signal: String
    let score: Int
    let reason: String
    let updatedAt: String?
    let hasPosition: Bool
}

enum CloudSignalService {
    static func fetch() async throws -> SignalAssessment {
        let url = URL(string: "https://tokenvalue-paper-trader.vercel.app/api/signal")!
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 10
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        let state = try JSONDecoder().decode(CloudSignalResponse.self, from: data)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        guard state.strategy == "crclb-v5-1-shadow",
              let timestamp = state.updatedAt,
              let updatedAt = formatter.date(from: timestamp),
              Date().timeIntervalSince(updatedAt) < 180 else {
            return unavailable("云端信号过期")
        }

        let signal: TradeSignal
        switch state.signal {
        case "buy": signal = .buy
        case "sell": signal = .sell
        case "risk": signal = .risk
        case "neutral": signal = .neutral
        default: return unavailable("云端信号不可用")
        }
        let detail = switch state.reason {
        case "v5.1-left-reversal": "确认底部并出现主动买盘，左侧试仓"
        case "v5.1-trend-pullback": "上升环境回踩后重新站上短线均线"
        case "v5.1-bottom-watch": "低位收回形成中，等待突破确认"
        case "v5.1-top-warning": "高点回落警戒，不开新仓"
        case "v5.1-risk-wait": "风险环境尚未出现确认底部与主动买盘"
        case "v5.1-conditions-not-met": "V5.1入场条件暂未满足"
        case "outside-regular-session": "美股非正常交易时段，不开新仓"
        case "off-hours-conditions-not-met": "休市时按CRCLB量价判断，当前条件不足"
        case "token-only-entry": "休市时CRCLB回踩后确认（无正股实时确认）"
        case "trend-risk": "趋势转弱；盈利仓自动上移至手续费保本线"
        case "confirmed-top": "CRCLB高点回落已获下一根K线确认"
        case "overextended": "价格远离短线均线，暂不追高"
        case "stale-underlying": "CRCL正股报价过期，不开新仓"
        case "conditions-not-met": "未满足CRCL趋势、成交量和溢折价条件"
        case "confirmed-entry": "CRCL与CRCLB趋势确认"
        case "trend-exit": "正股与CRCLB趋势转弱"
        default: state.reason
        }
        return SignalAssessment(
            symbol: "CRCLB · 云端v5.1",
            signal: signal,
            score: state.score,
            reasons: [state.hasPosition ? "模拟仓位：持有中" : "模拟仓位：空仓", detail],
            calculatedAt: updatedAt
        )
    }

    static func unavailable(_ reason: String) -> SignalAssessment {
        SignalAssessment(symbol: "CRCLB · 云端v5.1", signal: .unavailable,
                         score: 0, reasons: [reason], calculatedAt: .now)
    }
}
