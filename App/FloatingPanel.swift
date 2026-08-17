import AppKit
import SwiftUI

@MainActor
final class FloatingPanelController: NSObject, NSWindowDelegate {
    private let store: PriceStore
    private let panel: NSPanel

    init(store: PriceStore) {
        self.store = store
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 330, height: 178),
            styleMask: [.borderless, .nonactivatingPanel],
            backing: .buffered,
            defer: false
        )
        super.init()

        panel.delegate = self
        panel.contentView = NSHostingView(rootView: FloatingPriceCard(store: store))
        panel.level = .floating
        panel.collectionBehavior = [.canJoinAllSpaces, .fullScreenAuxiliary]
        panel.isMovableByWindowBackground = true
        panel.isOpaque = false
        panel.backgroundColor = .clear
        panel.hasShadow = false
        panel.hidesOnDeactivate = false
        panel.isReleasedWhenClosed = false
        panel.setFrameAutosaveName("PriceFloatingPanel")

        NotificationCenter.default.addObserver(
            self,
            selector: #selector(togglePanel),
            name: .togglePricePanel,
            object: nil
        )
    }

    func show() {
        if !panel.setFrameUsingName("PriceFloatingPanel") {
            panel.setFrameOrigin(defaultOrigin())
        }
        panel.orderFrontRegardless()
        store.setPanelVisible(true)
    }

    @objc private func togglePanel() {
        if panel.isVisible {
            panel.orderOut(nil)
            store.setPanelVisible(false)
        } else {
            show()
        }
    }

    func windowWillClose(_ notification: Notification) {
        store.setPanelVisible(false)
    }

    private func defaultOrigin() -> NSPoint {
        guard let frame = NSScreen.main?.visibleFrame else { return .zero }
        return NSPoint(
            x: frame.maxX - panel.frame.width - 24,
            y: frame.maxY - panel.frame.height - 24
        )
    }
}

extension Notification.Name {
    static let togglePricePanel = Notification.Name("togglePricePanel")
}

struct FloatingPriceCard: View {
    let store: PriceStore

    var body: some View {
        VStack(alignment: .leading, spacing: 13) {
            HStack {
                Text("LIVE MARKETS")
                    .font(.caption2.weight(.bold))
                    .tracking(1.3)
                    .foregroundStyle(.secondary)
                Spacer()
                if store.isLoading {
                    ProgressView().controlSize(.mini)
                } else {
                    Image(systemName: store.errorMessage == nil ? "circle.fill" : "wifi.exclamationmark")
                        .font(.system(size: 8))
                        .foregroundStyle(store.errorMessage == nil ? .green : .orange)
                }
            }

            if let snapshot = store.snapshot {
                HStack(spacing: 18) {
                    FloatingAsset(asset: snapshot.ethereum, color: .indigo)
                    Divider().frame(height: 50)
                    FloatingAsset(asset: snapshot.crclb, color: .green)
                }
                Text("每分钟刷新 · \(PriceFormatters.updated(snapshot.fetchedAt))")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
            } else if let error = store.errorMessage {
                Label(error, systemImage: "wifi.exclamationmark")
                    .font(.caption)
                    .foregroundStyle(.secondary)
            } else {
                ProgressView("正在获取行情…")
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .padding(18)
        .frame(width: 330, height: 178)
        .background {
            RoundedRectangle(cornerRadius: 20)
                .fill(.ultraThinMaterial)
                .opacity(0.58)
        }
        .overlay {
            RoundedRectangle(cornerRadius: 20)
                .strokeBorder(.white.opacity(0.10))
        }
    }
}

private struct FloatingAsset: View {
    let asset: AssetPrice
    let color: Color

    var body: some View {
        VStack(alignment: .leading, spacing: 5) {
            HStack(spacing: 6) {
                Circle().fill(color.gradient).frame(width: 8, height: 8)
                Text(asset.symbol).font(.caption.weight(.semibold))
            }
            Text(PriceFormatters.usd(asset.price))
                .font(.system(.title2, design: .rounded, weight: .heavy))
                .foregroundStyle(color)
                .shadow(color: color.opacity(0.16), radius: 1, y: 1)
                .contentTransition(.numericText())
                .minimumScaleFactor(0.72)
                .lineLimit(1)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}
