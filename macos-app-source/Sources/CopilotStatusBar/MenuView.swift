import SwiftUI

struct MenuView: View {
    @Bindable var commandRunner: CommandRunner
    @Bindable var statusMonitor: APIStatusMonitor
    @Bindable var launchAtLogin: LaunchAtLoginController
    @Environment(\.dismissWindow) private var dismissWindow

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // Header with current status
            HStack {
                Image(systemName: statusMonitor.currentStatus.iconName)
                    .font(.system(size: 16, weight: .medium))
                    .foregroundColor(statusColor)

                VStack(alignment: .leading, spacing: 2) {
                    Text("Copilot API")
                        .font(.system(size: 14, weight: .semibold))
                    Text(statusMonitor.statusText)
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(.secondary)
                        .lineLimit(1)
                }

                Spacer()

                Button {
                    Task {
                        await statusMonitor.forceRefresh()
                    }
                } label: {
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 12))
                        .foregroundColor(.secondary)
                }
                .buttonStyle(.plain)
            }

            Divider()

            // Action buttons based on current status
            VStack(spacing: 8) {
                switch statusMonitor.currentStatus {
                case .stopped, .error:
                    actionButton("Start Copilot API", systemImage: "play.circle.fill", color: .green) {
                        commandRunner.startCopilotAPI()
                        dismissAfterDelay()
                    }

                case .running:
                    HStack(spacing: 8) {
                        actionButton("Stop", systemImage: "stop.circle.fill", color: .red) {
                            commandRunner.stopCopilotAPI()
                            dismissAfterDelay()
                        }

                        actionButton("Restart", systemImage: "arrow.clockwise.circle.fill", color: .orange) {
                            commandRunner.restartCopilotAPI()
                            dismissAfterDelay()
                        }
                    }

                case .starting:
                    actionButton("Starting...", systemImage: "clock.circle.fill", color: .blue) {
                        // No action while starting
                    }
                    .disabled(true)

                case .unknown:
                    actionButton("Check Status", systemImage: "magnifyingglass.circle.fill", color: .blue) {
                        Task {
                            await statusMonitor.forceRefresh()
                        }
                    }
                }
            }

            Divider()

            // Launch at login toggle
            Toggle(isOn: Binding(
                get: { launchAtLogin.isEnabled },
                set: { launchAtLogin.setEnabled($0) }
            )) {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Launch at Login")
                        .font(.system(size: 13, weight: .medium))
                    Text("Start automatically when you log in")
                        .font(.system(size: 11, weight: .regular))
                        .foregroundColor(.secondary)
                }
            }
            .toggleStyle(.switch)
            .tint(.accentColor)

            if !launchAtLogin.statusMessage.isEmpty {
                Text(launchAtLogin.statusMessage)
                    .font(.system(size: 10, weight: .regular))
                    .foregroundColor(.secondary)
                    .lineLimit(2)
            }

            Divider()

            // Quit button
            Button("Quit Copilot Status Bar") {
                NSApplication.shared.terminate(nil)
            }
            .buttonStyle(.plain)
            .foregroundColor(.secondary)
            .frame(maxWidth: .infinity)
        }
        .padding(16)
        .frame(width: 260)
    }

    private func actionButton(
        _ title: String,
        systemImage: String,
        color: Color,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack {
                Image(systemName: systemImage)
                    .font(.system(size: 14, weight: .medium))
                Text(title)
                    .font(.system(size: 14, weight: .medium))
                Spacer()
            }
            .foregroundColor(.white)
            .padding(.horizontal, 12)
            .padding(.vertical, 8)
            .background(color)
            .cornerRadius(8)
        }
        .buttonStyle(.plain)
    }

    private var statusColor: Color {
        switch statusMonitor.currentStatus {
        case .running:
            return .green
        case .stopped:
            return .secondary
        case .starting:
            return .blue
        case .error:
            return .red
        case .unknown:
            return .secondary
        }
    }

    private func dismissAfterDelay() {
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
            dismissWindow()
        }
    }
}