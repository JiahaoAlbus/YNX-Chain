import Foundation
// Explicit owned synthetic lifecycle fixture: no networking, browser or authority.
@main struct SnowflakeBrowserHarmlessChild {
    static func main() { Thread.sleep(forTimeInterval: 30) }
}
