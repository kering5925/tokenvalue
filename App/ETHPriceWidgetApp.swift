import AppKit
import SwiftUI

@main
struct ETHPriceWidgetApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var store = PriceStore.shared

    var body: some Scene {
        MenuBarExtra {
            MenuBarContent(store: store)
        } label: {
            MenuBarLabel(snapshot: store.snapshot)
        }
        .menuBarExtraStyle(.menu)

        Settings {
            PriceDashboard(store: store)
                .frame(minWidth: 520, minHeight: 360)
        }
    }
}

@MainActor
final class AppDelegate: NSObject, NSApplicationDelegate {
    private var panelController: FloatingPanelController?

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.setActivationPolicy(.accessory)
        PriceStore.shared.start()

        let controller = FloatingPanelController(store: PriceStore.shared)
        controller.show()
        panelController = controller
    }
}
