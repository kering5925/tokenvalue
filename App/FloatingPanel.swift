import AppKit
import SwiftUI

@MainActor
final class FloatingPanelController: NSObject, NSWindowDelegate {
    private let store: PriceStore
    private let panel: NSPanel
    private var eventMonitors: [Any] = []
    private var captureRestoreTask: Task<Void, Never>?
    private var isHiddenForCapture = false

    init(store: PriceStore) {
        self.store = store
        panel = NSPanel(
            contentRect: NSRect(x: 0, y: 0, width: 330, height: 268),
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
        panel.ignoresMouseEvents = true
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
        NotificationCenter.default.addObserver(
            self,
            selector: #selector(togglePanelInteraction),
            name: .togglePricePanelInteraction,
            object: nil
        )
        installScreenshotMonitors()
    }

    func show() {
        if !panel.setFrameUsingName("PriceFloatingPanel") {
            panel.setFrameOrigin(defaultOrigin())
        }
        panel.setContentSize(NSSize(width: 330, height: 268))
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

    @objc private func togglePanelInteraction() {
        let interactive = panel.ignoresMouseEvents
        panel.ignoresMouseEvents = !interactive
        store.setPanelInteractive(interactive)
        if interactive {
            panel.orderFrontRegardless()
        }
    }

    private func installScreenshotMonitors() {
        let mask: NSEvent.EventTypeMask = [.keyDown, .leftMouseUp]

        if !CGPreflightListenEventAccess() {
            CGRequestListenEventAccess()
        }

        if let globalMonitor = NSEvent.addGlobalMonitorForEvents(
            matching: mask,
            handler: { [weak self] event in
                Task { @MainActor in self?.handleMonitoredEvent(event) }
            }
        ) {
            eventMonitors.append(globalMonitor)
        }

        if let localMonitor = NSEvent.addLocalMonitorForEvents(
            matching: mask,
            handler: { [weak self] event in
                Task { @MainActor in self?.handleMonitoredEvent(event) }
                return event
            }
        ) {
            eventMonitors.append(localMonitor)
        }
    }

    private func handleMonitoredEvent(_ event: NSEvent) {
        if event.type == .keyDown,
           event.modifierFlags.intersection(.deviceIndependentFlagsMask).contains([.command, .shift]),
           let key = event.charactersIgnoringModifiers,
           ["3", "4", "5"].contains(key) {
            hideForScreenshot(shortcut: key)
            return
        }

        if event.type == .leftMouseUp, isHiddenForCapture {
            scheduleCaptureRestore(after: .milliseconds(700))
        }
    }

    private func hideForScreenshot(shortcut: String) {
        guard panel.isVisible else { return }
        isHiddenForCapture = true
        panel.orderOut(nil)

        // Full-screen capture is immediate. Selection/window capture restores
        // after the finishing click, with this timeout as a safety fallback.
        scheduleCaptureRestore(after: shortcut == "3" ? .seconds(1) : .seconds(60))
    }

    private func scheduleCaptureRestore(after duration: Duration) {
        captureRestoreTask?.cancel()
        captureRestoreTask = Task { [weak self] in
            try? await Task.sleep(for: duration)
            guard !Task.isCancelled else { return }
            self?.restoreAfterScreenshot()
        }
    }

    private func restoreAfterScreenshot() {
        guard isHiddenForCapture else { return }
        isHiddenForCapture = false
        if store.isPanelVisible {
            panel.orderFrontRegardless()
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
    static let togglePricePanelInteraction = Notification.Name("togglePricePanelInteraction")
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

                HStack(spacing: 16) {
                    CompactSignal(
                        symbol: "ETH",
                        assessment: store.signal(for: "ETH")
                    )
                    CompactSignal(
                        symbol: "CRCLB",
                        assessment: store.signal(for: "CRCLB")
                    )
                }

                HStack {
                    TurningPointBadge(assessment: store.turningPoint(for: "ETH"))
                    Spacer(minLength: 8)
                    TurningPointBadge(assessment: store.turningPoint(for: "CRCLB"))
                }

                Text("每分钟刷新 · \(PriceFormatters.updated(snapshot.fetchedAt)) · CRCLB云端v2")
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
        .frame(width: 330, height: 268)
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

private struct CompactSignal: View {
    let symbol: String
    let assessment: SignalAssessment

    var body: some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(symbol)
                .font(.caption2.weight(.semibold))
                .foregroundStyle(.secondary)
            SignalBadge(assessment: assessment, compact: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
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
