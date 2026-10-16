import Foundation
import UserNotifications

@MainActor
enum TurningPointNotifier {
    static func notifyIfNew(_ assessment: TurningPointAssessment) async {
        guard assessment.kind == .bottomWatch || assessment.kind == .bottom || assessment.kind == .top,
              let candleTime = assessment.candleTime else { return }
        let key = "turningPoint.lastAlert.\(assessment.symbol)"
        let identifier = "\(assessment.symbol)-\(assessment.kind)-\(Int(candleTime.timeIntervalSince1970))"
        guard UserDefaults.standard.string(forKey: key) != identifier else { return }
        UserDefaults.standard.set(identifier, forKey: key)

        do {
            let center = UNUserNotificationCenter.current()
            guard try await center.requestAuthorization(options: [.alert, .sound]) else { return }
            let content = UNMutableNotificationContent()
            content.title = "\(assessment.symbol) · \(assessment.kind.rawValue)"
            content.body = switch assessment.kind {
            case .bottomWatch: "\(assessment.reason)。等待下一根15分钟K线确认。"
            case .bottom: "\(assessment.reason)。这是确认信号，不是自动交易指令。"
            case .top: "\(assessment.reason)。这是高点风险提醒，不会自动卖出。"
            case .none, .unavailable: assessment.reason
            }
            content.sound = .default
            try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
        } catch {
            // The card and menu bar still display the signal when notifications are unavailable.
        }
    }
}
