## Security Policy

### Supported Versions

We actively support the following versions with security updates:

| Version | Supported          |
| ------- | ------------------ |
| 1.x.x   | :white_check_mark: |
| < 1.0   | :x:                |

### Reporting a Vulnerability

The Copilot Status Bar team takes security seriously. If you discover a security vulnerability, please report it privately.

#### How to Report

1. **Email**: Send details to [security contact email] (if you have one)
2. **Private Issue**: Create a private security advisory on GitHub
3. **Do NOT** create a public issue for security vulnerabilities

#### What to Include

Please include the following information:
- Description of the vulnerability
- Steps to reproduce the issue
- Potential impact and exploitation scenarios
- Suggested fix (if you have one)
- Your contact information

#### Response Timeline

- **Initial Response**: Within 48 hours
- **Status Update**: Within 7 days
- **Resolution Timeline**: Depends on severity, typically 1-4 weeks

#### Security Considerations for Users

**This app has elevated permissions by design**:
- Executes terminal commands via AppleScript
- Can start/stop system processes
- Monitors network endpoints

**Best Practices**:
- Only download releases from official GitHub repository
- Verify app signatures when available
- Review source code if you have security concerns
- Report suspicious behavior immediately

#### Known Security Considerations

1. **Terminal Command Execution**: The app uses AppleScript to run terminal commands, which requires appropriate system permissions.

2. **Network Monitoring**: The app makes HTTP requests to localhost:4141 for status checking.

3. **Process Management**: The app can start/stop the Copilot API process using system commands.

All of these are intentional features, but users should be aware of the permissions this app requires.