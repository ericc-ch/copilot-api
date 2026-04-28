#!/bin/zsh
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
PRODUCT_NAME="CopilotStatusBar"
APP_DISPLAY_NAME="Copilot Status Bar"
BUNDLE_ID="local.copilot-status-bar"
APP_VERSION="1.0.0"
BUILD_NUMBER="1"

echo "Building Copilot Status Bar app..."

# Build the Swift package
echo "Building Swift package..."
cd "$ROOT_DIR"
swift build -c release

# Get build directory
BUILD_DIR="$(swift build -c release --show-bin-path)"
BUILD_BINARY="$BUILD_DIR/$PRODUCT_NAME"

# Create dist directory
mkdir -p "$ROOT_DIR/dist"
APP_DIR="$ROOT_DIR/dist/$APP_DISPLAY_NAME.app"
rm -rf "$APP_DIR"

# Create app bundle structure
CONTENTS_DIR="$APP_DIR/Contents"
MACOS_DIR="$CONTENTS_DIR/MacOS"
RESOURCES_DIR="$CONTENTS_DIR/Resources"

mkdir -p "$MACOS_DIR"
mkdir -p "$RESOURCES_DIR"

# Copy executable
cp "$BUILD_BINARY" "$MACOS_DIR/$PRODUCT_NAME"

# Create Info.plist
cat > "$CONTENTS_DIR/Info.plist" << EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleExecutable</key>
    <string>$PRODUCT_NAME</string>
    <key>CFBundleIdentifier</key>
    <string>$BUNDLE_ID</string>
    <key>CFBundleName</key>
    <string>$APP_DISPLAY_NAME</string>
    <key>CFBundleDisplayName</key>
    <string>$APP_DISPLAY_NAME</string>
    <key>CFBundleVersion</key>
    <string>$BUILD_NUMBER</string>
    <key>CFBundleShortVersionString</key>
    <string>$APP_VERSION</string>
    <key>CFBundlePackageType</key>
    <string>APPL</string>
    <key>LSMinimumSystemVersion</key>
    <string>14.0</string>
    <key>LSUIElement</key>
    <true/>
</dict>
</plist>
EOF

echo "App bundle created at: $APP_DIR"
echo "You can run it with: open '$APP_DIR'"