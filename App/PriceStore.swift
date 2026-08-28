import Foundation
import Observation
import WidgetKit

@MainActor
@Observable
final class PriceStore {
    static let shared = PriceStore()

    private(set) var snapshot: PriceSnapshot?
    private(set) var errorMessage: String?
    private(set) var isLoading = false
    private(set) var isPanelVisible = true
    private(set) var isPanelInteractive = false

    private var refreshTask: Task<Void, Never>?

    private init() {}

    func start() {
        guard refreshTask == nil else { return }
        refreshTask = Task { [weak self] in
            while !Task.isCancelled {
                await self?.refresh()
                do {
                    try await Task.sleep(for: .seconds(60))
                } catch {
                    return
                }
            }
        }
    }

    func refresh() async {
        guard !isLoading else { return }
        isLoading = true
        defer { isLoading = false }

        do {
            snapshot = try await PriceService.shared.fetch()
            errorMessage = nil
            WidgetCenter.shared.reloadTimelines(ofKind: "PriceWidget")
        } catch is CancellationError {
            return
        } catch {
            errorMessage = error.localizedDescription
        }
    }

    func setPanelVisible(_ visible: Bool) {
        isPanelVisible = visible
    }

    func setPanelInteractive(_ interactive: Bool) {
        isPanelInteractive = interactive
    }
}
