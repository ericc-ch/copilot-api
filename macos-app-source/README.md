# 🖥️ Copilot Status Bar

[![Build](https://github.com/USERNAME/copilot-status-bar/actions/workflows/build.yml/badge.svg)](https://github.com/USERNAME/copilot-status-bar/actions/workflows/build.yml)
[![Release](https://img.shields.io/github/v/release/USERNAME/copilot-status-bar)](https://github.com/USERNAME/copilot-status-bar/releases)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![macOS](https://img.shields.io/badge/macOS-14%2B-blue)](https://www.apple.com/macos/)
[![Swift](https://img.shields.io/badge/Swift-6.0-orange.svg)](https://swift.org)

A native macOS status bar app for monitoring and controlling the [Copilot API](https://www.npmjs.com/package/copilot-api) service. Built with SwiftUI and modern Swift concurrency.

<div align="center">

![App Screenshot](docs/images/menu-screenshot.png)
*Real-time API monitoring with contextual controls*

</div>

## ✨ Features

### 🚀 **Real-time API Monitoring**
- **Live Status Detection**: Automatically monitors Copilot API health via HTTP endpoints
- **Visual Status Indicators**: Dynamic status bar icons that change based on API state
- **Smart Refresh**: Background monitoring every 10 seconds + manual refresh option
- **Fallback Detection**: Port checking when HTTP health checks fail

### 📱 **Intelligent Menu Interface**  
- **Contextual Actions**: Menu buttons adapt based on current API state
  - **Stopped** → Show "Start" button
  - **Running** → Show "Stop" and "Restart" buttons  
  - **Starting** → Show progress indicator
- **Status Display**: Real-time status with last-updated timestamp
- **Quick Actions**: One-click start/stop/restart functionality

### 🔄 **Auto-Startup & Launch Control**
- **Launch at Login**: Native macOS ServiceManagement integration
- **Permission Handling**: Clear guidance for system permissions
- **Background Operation**: Runs as menu bar app (no dock icon)

### 🎯 **Native macOS Integration**
- **SwiftUI Interface**: Modern, native macOS design patterns  
- **Terminal Integration**: Commands run in Terminal.app with full visibility
- **System Permissions**: Proper handling of AppleScript and network permissions
- **Menu Bar Extra**: Uses modern `MenuBarExtra` API for seamless integration

## 📥 Installation

### Quick Install (Recommended)

1. **Download** the latest release from [Releases](https://github.com/USERNAME/copilot-status-bar/releases)
2. **Extract** the ZIP file
3. **Move** `Copilot Status Bar.app` to your Applications folder
4. **Launch** the app (right-click → Open for first launch to bypass Gatekeeper)
5. **Look** for the terminal icon in your menu bar

### Build from Source

```bash
# Clone the repository
git clone https://github.com/USERNAME/copilot-status-bar.git
cd copilot-status-bar

# Build the app
./scripts/build_app.sh

# Launch
open "dist/Copilot Status Bar.app"
```

## 🎮 Usage

### First Launch
1. **Grant Permissions**: Allow AppleScript and Terminal access when prompted
2. **Enable Auto-Start** (optional): Toggle "Launch at Login" in the menu
3. **Start Monitoring**: The app immediately begins checking API status

### Status Indicators
| Icon | Status | Description |
|------|--------|-------------|
| `🖥️` | Stopped | Copilot API is not running |
| `🖥️` | Running | Copilot API is active and responding |
| `🖥️` | Starting | API is being started (transitional) |
| `🖥️` | Error | API or network error detected |

### Menu Actions
- **Start Copilot API**: Opens Terminal and runs `sudo npx copilot-api@latest start`
- **Stop**: Terminates the Copilot API process
- **Restart**: Stops then starts the API service
- **Refresh**: Manually update status (also auto-refreshes every 10s)
- **Launch at Login**: Toggle auto-startup on system boot

## 🔧 How It Works

### Status Detection Strategy

1. **Primary**: HTTP Health Check
   ```bash
   curl http://localhost:4141/v1/models
   ```
   - `200 OK` = API Running ✅
   - `Connection Refused` = API Stopped ❌  
   - Other errors = API Error ⚠️

2. **Fallback**: Port Check  
   ```bash
   lsof -i :4141
   ```
   - Port listening = Something running on 4141
   - No listener = Port available

3. **Update Frequency**
   - **Background**: Every 10 seconds
   - **Manual**: Instant via refresh button  
   - **After Actions**: 2-3 second delay then refresh

### Command Execution
- Uses **AppleScript** to control Terminal.app
- Commands run with **full sudo support**
- **Terminal output visible** for transparency and debugging
- **Error handling** with user feedback

## 🛠️ Development

### Prerequisites
- **macOS 14.0+** (Sonoma or newer)
- **Xcode 15.4+** or Swift 6.0+ CLI tools
- **Swift Package Manager** (included with Xcode)

### Project Structure
```
copilot-status-bar/
├── .github/                           # GitHub workflows and templates
│   ├── workflows/build.yml           # CI/CD pipeline
│   └── ISSUE_TEMPLATE/               # Bug report & feature request templates
├── Sources/CopilotStatusBar/          # Swift source code
│   ├── CopilotStatusBarApp.swift     # Main app entry point
│   ├── MenuView.swift                # Status bar menu UI
│   ├── AppDelegate.swift             # App lifecycle management
│   └── Services/                     # Business logic services
│       ├── APIStatusMonitor.swift    # HTTP health checking & status management  
│       ├── CommandRunner.swift       # Terminal command execution via AppleScript
│       └── LaunchAtLoginController.swift # macOS startup integration
├── scripts/                          # Build and release automation
│   └── build_app.sh                 # App bundle creation script
├── Package.swift                     # Swift Package Manager configuration
├── LICENSE                          # MIT License
├── CONTRIBUTING.md                  # Contribution guidelines  
├── SECURITY.md                      # Security policy
└── README.md                        # This file
```

### Building & Testing

```bash
# Build Swift package
swift build -c release

# Create app bundle  
./scripts/build_app.sh

# Test the app
open "dist/Copilot Status Bar.app"
```

### Contributing

We welcome contributions! Please see [CONTRIBUTING.md](CONTRIBUTING.md) for:
- Development setup instructions
- Code style guidelines  
- Pull request process
- Testing checklist

## 📋 Requirements

### System Requirements
- **macOS 14.0+** (Sonoma or newer)
- **Apple Silicon** or **Intel Mac**
- **Copilot API** package installed via npm

### Permissions Required
- **AppleScript**: To control Terminal.app for command execution
- **Network**: To perform HTTP health checks on localhost
- **Login Items**: For auto-startup functionality (optional)

## ❓ FAQ

### **Q: Why does the app need AppleScript permission?**
A: The app uses AppleScript to open Terminal.app and run Copilot API commands. This provides full visibility into command execution and proper sudo handling.

### **Q: Is my data safe?**  
A: Yes! The app only makes local network requests to `localhost:4141` and doesn't collect or transmit any personal data. All source code is open and auditable.

### **Q: Can I customize the monitoring port?**
A: Currently, the app monitors the default Copilot API port (4141). Custom port support is planned for a future release.

### **Q: Why Swift instead of Electron/web technologies?**
A: Swift provides native macOS integration, better performance, smaller memory footprint, and seamless system permissions handling.

### **Q: The status shows "Error" - what should I check?**
A: Try these steps:
1. Manually check: `curl localhost:4141/v1/models`
2. Verify Copilot API is installed: `npx copilot-api@latest --version`
3. Check if another service is using port 4141
4. Click the refresh button in the menu

## 🔒 Security

Please report security vulnerabilities responsibly. See [SECURITY.md](SECURITY.md) for our security policy and reporting guidelines.

**Security Considerations**:
- App executes terminal commands (by design for functionality)
- Makes local network requests to monitor API health  
- Requires system permissions for AppleScript and login items

## 📄 License

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## 🙏 Acknowledgments

- **SwiftUI** for modern macOS app development
- **Copilot API** team for the excellent API service
- **macOS ServiceManagement** for proper launch-at-login integration
- **Community contributors** who help improve this project

## 📞 Support & Community

- 🐛 **Bug Reports**: [Create an Issue](https://github.com/USERNAME/copilot-status-bar/issues/new?template=bug_report.md)
- 💡 **Feature Requests**: [Request a Feature](https://github.com/USERNAME/copilot-status-bar/issues/new?template=feature_request.md)  
- 💬 **Discussions**: [GitHub Discussions](https://github.com/USERNAME/copilot-status-bar/discussions)
- 📖 **Documentation**: [Wiki](https://github.com/USERNAME/copilot-status-bar/wiki) (coming soon)

---

<div align="center">

**Made with ❤️ for the macOS developer community**

[⭐ Star this repository](https://github.com/USERNAME/copilot-status-bar) if you find it helpful!

</div>