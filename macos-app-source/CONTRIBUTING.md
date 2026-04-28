# Contributing to Copilot Status Bar

We love your input! We want to make contributing to Copilot Status Bar as easy and transparent as possible, whether it's:

- Reporting a bug
- Discussing the current state of the code
- Submitting a fix
- Proposing new features
- Becoming a maintainer

## 🚀 Quick Start for Contributors

### Prerequisites
- **macOS 14.0+** (Sonoma or newer)
- **Xcode 15.4+** or Swift 6.0+ command line tools
- **Git** for version control

### Setting Up Development Environment

1. **Fork and Clone**
   ```bash
   git clone https://github.com/YOUR_USERNAME/copilot-status-bar.git
   cd copilot-status-bar
   ```

2. **Build the Project**
   ```bash
   ./scripts/build_app.sh
   ```

3. **Run the App**
   ```bash
   open "dist/Copilot Status Bar.app"
   ```

## 📝 Development Process

We use [GitHub flow](https://guides.github.com/introduction/flow/index.html), so all code changes happen through pull requests.

### Pull Request Process

1. **Create a Branch**
   ```bash
   git checkout -b feature/your-feature-name
   # or
   git checkout -b fix/bug-description
   ```

2. **Make Your Changes**
   - Write clean, documented Swift code
   - Follow existing code style and patterns
   - Test your changes thoroughly

3. **Commit Your Changes**
   ```bash
   git add .
   git commit -m "Add: brief description of changes"
   ```

4. **Push and Create PR**
   ```bash
   git push origin feature/your-feature-name
   ```
   Then create a Pull Request on GitHub.

## 🛠️ Code Style Guidelines

### Swift Code Style
- Use **SwiftUI** patterns and declarative syntax
- Follow **Swift API Design Guidelines**
- Use `@MainActor` for UI-related classes
- Prefer `async/await` over completion handlers
- Use `@Observable` for data models

### Code Organization
- Keep services in `Sources/CopilotStatusBar/Services/`
- Keep UI components in the main directory
- Use descriptive file and class names
- Write inline documentation for public methods

### Example Code Style
```swift
@Observable
@MainActor
final class APIStatusMonitor {
    var currentStatus: Status = .unknown
    
    func startMonitoring() {
        // Clear, descriptive method names
        guard !isMonitoring else { return }
        // ... implementation
    }
}
```

## 🧪 Testing

### Manual Testing Checklist
Before submitting a PR, test these scenarios:

- [ ] App builds successfully
- [ ] Status bar icon appears and updates correctly
- [ ] Menu opens and displays current status
- [ ] Start/Stop/Restart commands work
- [ ] Launch-at-login toggle functions
- [ ] Status monitoring works (with API running and stopped)
- [ ] App handles network timeouts gracefully
- [ ] App quits cleanly

### Future: Automated Testing
We plan to add unit tests for:
- API status detection logic
- Command execution
- Status state management

## 📋 Reporting Bugs

We use GitHub issues to track public bugs. Report a bug by [opening a new issue](https://github.com/USERNAME/copilot-status-bar/issues/new?template=bug_report.md).

**Great Bug Reports** have:
- A quick summary and/or background
- Steps to reproduce (be specific!)
- What you expected vs. what actually happened
- macOS version, app version, and environment details
- Screenshots if applicable

## 💡 Suggesting Features

We welcome feature suggestions! Use our [feature request template](https://github.com/USERNAME/copilot-status-bar/issues/new?template=feature_request.md).

**Great Feature Requests** include:
- Clear description of the feature
- Problem or use case it solves
- Proposed UI/UX integration
- Why it would be valuable to users

## 🏗️ Project Structure

```
copilot-status-bar/
├── .github/                    # GitHub templates and workflows
├── Sources/CopilotStatusBar/   # Swift source code
│   ├── Services/              # Business logic services
│   ├── *.swift               # UI components and main app
├── scripts/                   # Build and release scripts
├── dist/                      # Built app (ignored by git)
├── Package.swift             # Swift Package Manager config
└── README.md                 # Project documentation
```

### Key Components
- **CopilotStatusBarApp.swift**: Main app entry point and MenuBarExtra setup
- **MenuView.swift**: Status bar menu UI using SwiftUI
- **APIStatusMonitor.swift**: HTTP health checking and status management
- **CommandRunner.swift**: Terminal command execution via AppleScript
- **LaunchAtLoginController.swift**: macOS startup integration

## 🚢 Release Process

### Versioning
We use [Semantic Versioning](http://semver.org/):
- `MAJOR.MINOR.PATCH` (e.g., `1.0.0`)
- **MAJOR**: Breaking changes
- **MINOR**: New features (backwards compatible)
- **PATCH**: Bug fixes (backwards compatible)

### Creating Releases
1. Update version in appropriate files
2. Create and push a git tag: `git tag v1.0.0 && git push origin v1.0.0`
3. GitHub Actions automatically builds and creates the release
4. Add release notes describing changes

## 📞 Community & Support

- **Issues**: [GitHub Issues](https://github.com/USERNAME/copilot-status-bar/issues)
- **Discussions**: [GitHub Discussions](https://github.com/USERNAME/copilot-status-bar/discussions)

## 📜 Code of Conduct

### Our Pledge
We pledge to make participation in our project a harassment-free experience for everyone, regardless of age, body size, disability, ethnicity, gender identity and expression, level of experience, nationality, personal appearance, race, religion, or sexual identity and orientation.

### Expected Behavior
- Be respectful and inclusive
- Focus on constructive feedback
- Help create a welcoming environment
- Be patient with newcomers

### Unacceptable Behavior
- Harassment or discrimination of any kind
- Trolling, insulting, or derogatory comments
- Personal or political attacks
- Publishing others' private information

## 🎉 Recognition

Contributors are recognized in:
- GitHub contributors list
- Release notes for significant contributions
- Special mentions for major features or fixes

Thank you for contributing to Copilot Status Bar! 🚀