# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.8.0] - 2025-01-31

### Added
- GitHub Enterprise Server/Cloud support
  - New `--enterprise-url` flag for `auth` and `start` commands
  - Interactive prompt during auth for enterprise configuration
  - Persistent enterprise URL storage in `~/.local/share/copilot-api/enterprise_url`
  - Automatic endpoint routing for enterprise instances
- Comprehensive test suite with 41 new tests covering enterprise functionality
- URL normalization utilities for enterprise host configuration

### Changed
- OAuth endpoints now use enterprise URLs when configured
- Copilot API endpoints route to `copilot-api.{enterprise}` for enterprise users
- GitHub API endpoints route to `api.{enterprise}` for enterprise users

### Technical Details
- Enterprise endpoint structure:
  - OAuth: `https://{enterprise}/login/...`
  - GitHub API: `https://api.{enterprise}/...`
  - Copilot API: `https://copilot-api.{enterprise}/...`
- 100% backwards compatible - defaults to github.com when no enterprise configured

## [0.7.0] - Previous Release
- See git history for details
