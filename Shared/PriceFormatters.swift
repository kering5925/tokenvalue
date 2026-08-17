import Foundation

enum PriceFormatters {
    static func usd(_ value: Double) -> String {
        if value >= 100 {
            return value.formatted(
                .currency(code: "USD").precision(.fractionLength(2))
            )
        }
        return value.formatted(
            .currency(code: "USD").precision(.fractionLength(2...4))
        )
    }

    static func updated(_ date: Date) -> String {
        date.formatted(date: .omitted, time: .shortened)
    }
}
