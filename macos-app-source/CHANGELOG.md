# Changelog

All notable changes to Copilot Status Bar will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added
- Initial GitHub release preparation

### Changed

### Deprecated

### Removed

### Fixed

### Security

## [1.0.0] - 2026-04-28

### Added
- Real-time Copilot API status monitoring via HTTP health checks
- Dynamic status bar icons that change based on API state
- Smart menu interface with contextual actions (Start/Stop/Restart)
- Launch at Login functionality using macOS ServiceManagement
- Background monitoring every 10 seconds with manual refresh option
- Fallback port checking when HTTP health checks fail
- Native SwiftUI interface with modern macOS design patterns
- Terminal.app integration for command execution with full visibility
- Proper async/await architecture with @MainActor isolation
- AppleScript integration for terminal command execution
- Status display with last-updated timestamps
- Error handling and graceful degradation

### Technical Details
- Built with Swift 6.0 and SwiftUI
- Uses MenuBarExtra API for native status bar integration
- Implements @Observable pattern for reactive UI updates
- ServiceManagement framework for launch-at-login
- HTTP health checking with URLSession
- Process monitoring via lsof for port checking

## Release Links

[Unreleased]: https://github.com/USERNAME/copilot-status-bar/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/USERNAME/copilot-status-bar/releases/tag/v1.0.0