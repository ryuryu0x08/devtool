// swift-tools-version:5.9
// QuotaBar: a macOS menu bar app for the usage of several API keys, and for switching the key
// Claude Code uses. Apple frameworks only.
import PackageDescription

let package = Package(
  name: "QuotaBar",
  platforms: [.macOS(.v14)],
  targets: [
    // Reading the usage API, working out what is left, history, and editing settings.json.
    .target(name: "QuotaCore", linkerSettings: [.linkedLibrary("sqlite3")]),
    // The app itself (SwiftUI, Swift Charts, AppKit).
    .executableTarget(name: "QuotaBar", dependencies: ["QuotaCore"]),
    .testTarget(name: "QuotaCoreTests", dependencies: ["QuotaCore"]),
  ]
)
