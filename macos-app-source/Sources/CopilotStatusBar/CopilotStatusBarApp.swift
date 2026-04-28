import AppKit
import SwiftUI

@main
struct CopilotStatusBarApp: App {
    @NSApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var commandRunner = CommandRunner()
    @State private var statusMonitor = APIStatusMonitor()
    @State private var launchAtLogin = LaunchAtLoginController()

    var body: some Scene {
        MenuBarExtra {
            MenuView(
                commandRunner: commandRunner,
                statusMonitor: statusMonitor,
                launchAtLogin: launchAtLogin
            )
            .onAppear {
                // Connect the command runner to the status monitor
                commandRunner.statusMonitor = statusMonitor
            }
        } label: {
            Label("Copilot API", systemImage: statusMonitor.currentStatus.iconName)
                .labelStyle(.iconOnly)
        }
        .menuBarExtraStyle(.window)
    }
}