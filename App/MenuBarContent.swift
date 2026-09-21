import AppKit
import SwiftUI

struct MenuBarLabel: View {
    let snapshot: PriceSnapshot?

    var body: some View {
        if let snapshot {
            Text("ETH \(compact(snapshot.ethereum.price)) · CRCLB \(compact(snapshot.crclb.price))")
        } else {
            Label("行情", systemImage: "chart.line.uptrend.xyaxis")
        }
    }

    private func compact(_ value: Double) -> String {
        value.formatted(.number.precision(.fractionLength(2)))
    }
}

struct MenuBarContent: View {
    let store: PriceStore

    var body: some View {
        if let snapshot = store.snapshot {
            PriceMenuRow(asset: snapshot.ethereum)
            PriceMenuRow(asset: snapshot.crclb)
            Text("更新于 \(PriceFormatters.updated(snapshot.fetchedAt))")
        } else if let error = store.errorMessage {
            Text("行情获取失败：\(error)")
        } else {
            Text("正在获取行情…")
        }

        Divider()
        SignalMenuRow(assessment: store.signal(for: "ETH"))
        SignalMenuRow(assessment: store.signal(for: "CRCLB"))
        if let signalError = store.signalErrorMessage {
            Text("信号更新失败：\(signalError)")
        }
        Divider()
        ForEach(["ETH", "CRCLB"], id: \.self) { symbol in
            let point = store.turningPoint(for: symbol)
            Text("\(symbol) · \(point.kind.rawValue) · \(point.reason)")
        }

        Divider()
        Button("立即刷新") {
            Task { await store.refresh() }
        }
        .keyboardShortcut("r")

        Button(store.isPanelVisible ? "隐藏悬浮卡片" : "显示悬浮卡片") {
            NotificationCenter.default.post(name: .togglePricePanel, object: nil)
        }
        .keyboardShortcut("p")

        Button(store.isPanelInteractive ? "锁定位置并穿透鼠标" : "移动悬浮卡片") {
            NotificationCenter.default.post(name: .togglePricePanelInteraction, object: nil)
        }

        Divider()
        Button("退出") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
    }
}

private struct SignalMenuRow: View {
    let assessment: SignalAssessment

    var body: some View {
        Text(
            "\(assessment.symbol) · \(assessment.signal.rawValue) "
                + "\(assessment.signal == .paused || assessment.signal == .unavailable ? "" : "\(assessment.score) · ")"
                + assessment.reasons.prefix(2).joined(separator: " / ")
        )
    }
}

private struct PriceMenuRow: View {
    let asset: AssetPrice

    var body: some View {
        HStack {
            Text(asset.symbol)
            Spacer()
            Text(PriceFormatters.usd(asset.price))
                .monospacedDigit()
        }
    }
}
