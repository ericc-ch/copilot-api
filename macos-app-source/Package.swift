// swift-tools-version: 6.1
import PackageDescription

let package = Package(
    name: "CopilotStatusBar",
    platforms: [
        .macOS(.v14)
    ],
    products: [
        .executable(name: "CopilotStatusBar", targets: ["CopilotStatusBar"])
    ],
    targets: [
        .executableTarget(
            name: "CopilotStatusBar",
            path: "Sources/CopilotStatusBar",
            linkerSettings: [
                .linkedFramework("ServiceManagement")
            ]
        )
    ]
)