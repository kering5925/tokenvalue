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
        guard state.strategy == "crclb-underlying-v2",
              let timestamp = state.updatedAt,
              let updatedAt = formatter.date(from: timestamp),
              Date().timeIntervalSince(updatedAt) < 180 else {
            return unavailable("云端信号过期")
        }

        let signal: TradeSignal
        switch state.signal {
        case "buy": signal = .buy
        case "sell": signal = .sell
        case "neutral": signal = .neutral
        default: return unavailable("云端信号不可用")
        }
        let detail = switch state.reason {
        case "outside-regular-session": "美股非正常交易时段，不开新仓"
        case "off-hours-conditions-not-met": "休市时按CRCLB量价判断，当前条件不足"
        case "token-only-entry": "休市时CRCLB放量突破（无正股实时确认）"
        case "token-only-exit": "休市时CRCLB趋势转弱"
        case "stale-underlying": "CRCL正股报价过期，不开新仓"
        case "conditions-not-met": "未满足CRCL趋势、成交量和溢折价条件"
        case "confirmed-entry": "CRCL与CRCLB趋势确认"
        case "trend-exit": "正股与CRCLB趋势转弱"
        default: state.reason
        }
        return SignalAssessment(
            symbol: "CRCLB · 云端v2",
            signal: signal,
            score: state.score,
            reasons: [state.hasPosition ? "模拟仓位：持有中" : "模拟仓位：空仓", detail],
            calculatedAt: updatedAt
        )
    }

    static func unavailable(_ reason: String) -> SignalAssessment {
        SignalAssessment(symbol: "CRCLB · 云端v2", signal: .unavailable,
                         score: 0, reasons: [reason], calculatedAt: .now)
    }
}
