import SwiftUI

struct SignalBadge: View {
    let assessment: SignalAssessment
    var compact = false

    var body: some View {
        HStack(spacing: 5) {
            Circle()
                .fill(color)
                .frame(width: 7, height: 7)
            Text(assessment.signal.rawValue)
                .font(compact ? .caption2.weight(.bold) : .caption.weight(.bold))
            if assessment.signal != .paused && assessment.signal != .unavailable {
                Text("\(assessment.score)")
                    .font(compact ? .caption2.monospacedDigit() : .caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
        }
        .foregroundStyle(color)
    }

    var color: Color {
        switch assessment.signal {
        case .buy: .green
        case .sell: .red
        case .neutral: .orange
        case .paused: .secondary
        case .unavailable: .gray
        }
    }
}

struct SignalDetailCard: View {
    let assessment: SignalAssessment

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                Text(assessment.symbol).font(.headline)
                Spacer()
                SignalBadge(assessment: assessment)
            }
            Text(assessment.reasons.joined(separator: " · "))
                .font(.caption)
                .foregroundStyle(.secondary)
                .lineLimit(2)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(12)
        .background(.quaternary, in: RoundedRectangle(cornerRadius: 12))
    }
}

struct TurningPointBadge: View {
    let assessment: TurningPointAssessment

    var body: some View {
        Text("\(assessment.symbol) \(assessment.kind.rawValue)")
            .font(.caption2.weight(.semibold))
            .foregroundStyle(color)
            .lineLimit(1)
            .minimumScaleFactor(0.8)
    }

    private var color: Color {
        switch assessment.kind {
        case .bottom: .green
        case .top: .red
        case .none, .unavailable: .secondary
        }
    }
}
