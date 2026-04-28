import Foundation
import AppKit

@Observable
@MainActor
class CommandRunner {
    weak var statusMonitor: APIStatusMonitor?

    func startCopilotAPI() {
        // Set status to starting
        statusMonitor?.currentStatus = .starting

        // Create the terminal command to run
        let command = "sudo npx copilot-api@latest start"

        // Use AppleScript to open Terminal and run the command
        let script = """
        tell application "Terminal"
            activate
            do script "\(command)"
        end tell
        """

        // Execute the AppleScript
        if let appleScript = NSAppleScript(source: script) {
            var errorDict: NSDictionary?
            appleScript.executeAndReturnError(&errorDict)

            if let error = errorDict {
                print("AppleScript Error: \(error)")
                statusMonitor?.currentStatus = .error
            } else {
                // Give the API a moment to start, then check status
                Task {
                    try? await Task.sleep(for: .seconds(3))
                    await self.statusMonitor?.forceRefresh()
                }
            }
        }
    }

    func stopCopilotAPI() {
        // Find and kill the copilot-api process
        let script = """
        tell application "Terminal"
            activate
            do script "pkill -f 'copilot-api.*start' || echo 'No Copilot API process found'"
        end tell
        """

        if let appleScript = NSAppleScript(source: script) {
            var errorDict: NSDictionary?
            appleScript.executeAndReturnError(&errorDict)

            if let error = errorDict {
                print("AppleScript Error: \(error)")
            }

            // Update status after a brief delay
            Task {
                try? await Task.sleep(for: .seconds(2))
                await self.statusMonitor?.forceRefresh()
            }
        }
    }

    func restartCopilotAPI() {
        stopCopilotAPI()

        // Wait a bit then start again
        Task {
            try? await Task.sleep(for: .seconds(3))
            await self.startCopilotAPI()
        }
    }
}