import Foundation
import Observation
import WidgetKit

@MainActor
@Observable
final class PriceStore {
    static let shared = PriceStore()

    private(set) var snapshot: PriceSnapshot?
    private(set) var errorMessage: String?
    private(set) var signalErrorMessage: String?
    private(set) var signals: [String: SignalAssessment] = [
        "ETH": SignalAssessment(symbol: "ETH", signal: .paused, score: 0,
                                reasons: ["仅显示价格，不再生成交易提醒"], calculatedAt: .now),
        "CRCLB": CloudSignalService.unavailable("正在获取云端策略")
    ]
    private(set) var turningPoints: [String: TurningPointAssessment] = [
        "ETH": .unavailable(symbol: "ETH", reason: "正在获取K线"),
        "CRCLB": .unavailable(symbol: "CRCLB", reason: "正在获取K线")
    ]
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

        do {
            signals["CRCLB"] = try await CloudSignalService.fetch()
            signalErrorMessage = nil
        } catch is CancellationError {
            return
        } catch {
            signals["CRCLB"] = CloudSignalService.unavailable("云端连接失败")
            signalErrorMessage = error.localizedDescription
        }

        do {
            let assessments = try await MarketHistoryService.shared.turningPoints()
            turningPoints = assessments
            for assessment in assessments.values {
                await TurningPointNotifier.notifyIfNew(assessment)
            }
        } catch is CancellationError {
            return
        } catch {
            turningPoints = [
                "ETH": .unavailable(symbol: "ETH", reason: "K线获取失败"),
                "CRCLB": .unavailable(symbol: "CRCLB", reason: "K线获取失败")
            ]
        }
    }

    func setPanelVisible(_ visible: Bool) {
        isPanelVisible = visible
    }

    func setPanelInteractive(_ interactive: Bool) {
        isPanelInteractive = interactive
    }

    func signal(for symbol: String) -> SignalAssessment {
        signals[symbol] ?? .loading(symbol: symbol)
    }

    func turningPoint(for symbol: String) -> TurningPointAssessment {
        turningPoints[symbol] ?? .unavailable(symbol: symbol, reason: "K线获取失败")
    }
}
