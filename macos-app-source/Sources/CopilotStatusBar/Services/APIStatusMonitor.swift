import Foundation
import Observation

@Observable
@MainActor
final class APIStatusMonitor {
    enum Status {
        case running
        case stopped
        case starting
        case error
        case unknown

        var displayName: String {
            switch self {
            case .running: return "Running"
            case .stopped: return "Stopped"
            case .starting: return "Starting..."
            case .error: return "Error"
            case .unknown: return "Unknown"
            }
        }

        var iconName: String {
            switch self {
            case .running: return "terminal.fill"
            case .stopped: return "terminal"
            case .starting: return "terminal.badge.clock"
            case .error: return "terminal.slash"
            case .unknown: return "terminal"
            }
        }
    }

    var currentStatus: Status = .unknown
    var lastChecked: Date?
    var isMonitoring = false

    private var timer: Timer?
    private let healthCheckURL = URL(string: "http://localhost:4141/v1/models")!
    private let session = URLSession.shared

    init() {
        startMonitoring()
    }

    deinit {
        // Note: We can't call stopMonitoring() here due to MainActor isolation
        // The timer will be cleaned up automatically when the object is deallocated
    }

    func startMonitoring() {
        guard !isMonitoring else { return }

        isMonitoring = true
        checkStatus()

        // Check every 10 seconds
        timer = Timer.scheduledTimer(withTimeInterval: 10.0, repeats: true) { [weak self] _ in
            Task { @MainActor in
                self?.checkStatus()
            }
        }
    }

    func stopMonitoring() {
        isMonitoring = false
        timer?.invalidate()
        timer = nil
    }

    func checkStatus() {
        Task {
            let status = await performHealthCheck()
            self.currentStatus = status
            self.lastChecked = Date()
        }
    }

    func forceRefresh() async {
        checkStatus()
    }

    private func performHealthCheck() async -> Status {
        do {
            // Create request with timeout
            var request = URLRequest(url: healthCheckURL)
            request.timeoutInterval = 3.0
            request.httpMethod = "GET"

            let (_, response) = try await session.data(for: request)

            if let httpResponse = response as? HTTPURLResponse {
                switch httpResponse.statusCode {
                case 200...299:
                    return .running
                case 400...599:
                    return .error
                default:
                    return .error
                }
            }

            return .error
        } catch {
            // If HTTP fails, try port check as fallback
            return await checkPortStatus()
        }
    }

    private func checkPortStatus() async -> Status {
        return await withCheckedContinuation { continuation in
            let process = Process()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/lsof")
            process.arguments = ["-i", ":4141"]

            let pipe = Pipe()
            process.standardOutput = pipe
            process.standardError = Pipe()

            do {
                try process.run()
                process.waitUntilExit()

                let data = pipe.fileHandleForReading.readDataToEndOfFile()
                let output = String(data: data, encoding: .utf8) ?? ""

                // If lsof finds something listening on port 4141, consider it running
                if output.contains("LISTEN") {
                    continuation.resume(returning: .running)
                } else {
                    continuation.resume(returning: .stopped)
                }
            } catch {
                continuation.resume(returning: .stopped)
            }
        }
    }

    var statusText: String {
        let status = currentStatus.displayName
        if let lastChecked = lastChecked {
            let formatter = DateFormatter()
            formatter.timeStyle = .medium
            return "\(status) • Updated \(formatter.string(from: lastChecked))"
        }
        return status
    }
}