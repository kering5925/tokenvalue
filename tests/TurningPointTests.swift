import Foundation

@main
struct TurningPointTests {
    static func main() {
        let now = Date()
        func candles(descending: Bool) -> [Candle] {
            (0..<40).map { index in
                let close = descending ? 100 - Double(index) * 0.4 : 100 + Double(index) * 0.4
                return Candle(symbol: "ETHUSDT", interval: "15m",
                    openTime: now.addingTimeInterval(Double(index - 40) * 900),
                    closeTime: now.addingTimeInterval(Double(index - 39) * 900 - 1),
                    open: close + (descending ? 0.1 : -0.1), high: close + 0.3,
                    low: close - 0.3, close: close, volume: 100)
            }
        }

        var down = candles(descending: true)
        let lastDown = down.removeLast()
        down.append(Candle(symbol: lastDown.symbol, interval: lastDown.interval,
            openTime: lastDown.openTime, closeTime: lastDown.closeTime,
            open: 84, high: 86.2, low: 83.7, close: 86, volume: 200))
        assert(TurningPointEngine.assess(symbol: "ETH", candles: down, now: now).kind == .bottomWatch)
        down.append(Candle(symbol: lastDown.symbol, interval: lastDown.interval,
            openTime: lastDown.openTime.addingTimeInterval(900),
            closeTime: lastDown.closeTime.addingTimeInterval(900),
            open: 86, high: 86.6, low: 85.9, close: 86.4, volume: 100))
        assert(TurningPointEngine.assess(symbol: "ETH", candles: down,
            now: now.addingTimeInterval(900)).kind == .bottom)

        var up = candles(descending: false)
        let lastUp = up.removeLast()
        up.append(Candle(symbol: lastUp.symbol, interval: lastUp.interval,
            openTime: lastUp.openTime, closeTime: lastUp.closeTime,
            open: 116, high: 116.3, low: 113.8, close: 114, volume: 200))
        assert(TurningPointEngine.assess(symbol: "CRCLB", candles: up, now: now).kind == .top)
        assert(TurningPointEngine.assess(symbol: "ETH", candles: candles(descending: true), now: now).kind == .none)
        assert(TurningPointEngine.assess(symbol: "ETH", candles: down,
            now: now.addingTimeInterval(2800)).kind == .unavailable)
        print("Turning point tests passed")
    }
}
