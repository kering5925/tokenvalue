import Foundation
import UserNotifications

@MainActor
enum TurningPointNotifier {
    static func notifyIfNew(_ assessment: TurningPointAssessment) async {
        guard assessment.kind == .bottom || assessment.kind == .top,
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
            content.body = "\(assessment.reason)。仅为早期观察，不代表底部或顶部已确认。"
            content.sound = .default
            try await center.add(UNNotificationRequest(identifier: identifier, content: content, trigger: nil))
        } catch {
            // The card and menu bar still display the signal when notifications are unavailable.
        }
    }
}
