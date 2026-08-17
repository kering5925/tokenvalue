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
        Button("立即刷新") {
            Task { await store.refresh() }
        }
        .keyboardShortcut("r")

        Button(store.isPanelVisible ? "隐藏悬浮卡片" : "显示悬浮卡片") {
            NotificationCenter.default.post(name: .togglePricePanel, object: nil)
        }
        .keyboardShortcut("p")

        Divider()
        Button("退出") {
            NSApplication.shared.terminate(nil)
        }
        .keyboardShortcut("q")
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

