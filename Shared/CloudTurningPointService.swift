import Foundation

private struct CloudTurningPointResponse: Decodable {
    struct Point: Decodable {
        let kind: String
        let reason: String
        let candleTime: String?
    }
    let points: [String: Point]
}

enum CloudTurningPointService {
    static func fetch() async throws -> [String: TurningPointAssessment] {
        let url = URL(string: "https://tokenvalue-paper-trader.vercel.app/api/turning-points")!
        var request = URLRequest(url: url)
        request.cachePolicy = .reloadIgnoringLocalCacheData
        request.timeoutInterval = 10
        let (data, response) = try await URLSession.shared.data(for: request)
        guard let http = response as? HTTPURLResponse, http.statusCode == 200 else {
            throw URLError(.badServerResponse)
        }
        let state = try JSONDecoder().decode(CloudTurningPointResponse.self, from: data)
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return Dictionary(uniqueKeysWithValues: ["ETH", "CRCLB"].map { symbol in
            guard let point = state.points[symbol] else {
                return (symbol, TurningPointAssessment.unavailable(symbol: symbol, reason: "云端尚无拐点记录"))
            }
            let kind: TurningPointKind
            switch point.kind {
            case "bottom-watch": kind = .bottomWatch
            case "bottom": kind = .bottom
            case "top": kind = .top
            case "none": kind = .none
            default: kind = .unavailable
            }
            let candleTime = point.candleTime.flatMap { formatter.date(from: $0) }
            return (symbol, TurningPointAssessment(
                symbol: symbol, kind: kind, reason: point.reason, candleTime: candleTime
            ))
        })
    }
}
