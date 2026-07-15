import Cocoa
import WebKit

final class CommandBridge: NSObject, WKScriptMessageHandler {
    private weak var webView: WKWebView?
    private var processes: [String: Process] = [:]
    private let lock = NSLock()

    init(webView: WKWebView) { self.webView = webView }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let action = body["action"] as? String, let id = body["id"] as? String else { return }
        if action == "cancel" { lock.lock(); let process = processes[id]; lock.unlock(); process?.terminate(); return }
        guard action == "run", let payload = body["payload"] as? [String: Any] else { return }
        DispatchQueue.global(qos: .userInitiated).async { self.run(id: id, payload: payload) }
    }

    private func run(id: String, payload: [String: Any]) {
        do {
            guard let task = payload["task"] as? String, let projectID = payload["projectId"] as? String,
                  let files = payload["files"] as? [String: String], ["test", "check"].contains(task) else { throw BridgeError.invalidRequest }
            let safeID = projectID.filter { $0.isLetter || $0.isNumber || $0 == "_" || $0 == "-" }
            guard safeID == projectID, !safeID.isEmpty, files.count > 0, files.count <= 500 else { throw BridgeError.invalidProject }
            let manager = FileManager.default
            let support = try manager.url(for: .applicationSupportDirectory, in: .userDomainMask, appropriateFor: nil, create: true)
            let project = support.appendingPathComponent("YNXDeveloper/Workspaces/\(safeID)", isDirectory: true)
            try? manager.removeItem(at: project)
            try manager.createDirectory(at: project, withIntermediateDirectories: true)
            var total = 0
            for (path, content) in files {
                guard valid(path: path), let data = content.data(using: .utf8), data.count <= 524_288 else { throw BridgeError.invalidProject }
                total += data.count; guard total <= 5_242_880 else { throw BridgeError.invalidProject }
                let target = project.appendingPathComponent(path)
                try manager.createDirectory(at: target.deletingLastPathComponent(), withIntermediateDirectories: true)
                try data.write(to: target, options: .atomic)
            }
            let jsFiles = files.keys.filter { $0.hasSuffix(".js") }.sorted().map { project.appendingPathComponent($0).path }
            let testFiles = files.keys.filter { $0.hasPrefix("test/") && $0.hasSuffix(".test.js") }.sorted().map { project.appendingPathComponent($0).path }
            let targets = task == "test" ? testFiles : jsFiles
            guard !targets.isEmpty else { throw BridgeError.noTargets }
            let profile = "(version 1)\n(allow default)\n(deny network*)\n(deny file-write* (require-not (subpath \"\(escape(project.path))\")) (require-not (subpath \"/private/tmp\")) (require-not (subpath \"/dev\")))"
            let process = Process(); let output = Pipe()
            process.executableURL = URL(fileURLWithPath: "/usr/bin/sandbox-exec")
            process.arguments = ["-p", profile, "/usr/bin/env", "node"] + (task == "test" ? ["--test"] : ["--check"]) + targets
            process.currentDirectoryURL = project
            process.standardOutput = output; process.standardError = output
            output.fileHandleForReading.readabilityHandler = { [weak self] handle in
                let data = handle.availableData; guard !data.isEmpty, let text = String(data: data, encoding: .utf8) else { return }
                self?.emit(["id": id, "type": "chunk", "text": text])
            }
            process.terminationHandler = { [weak self] finished in
                output.fileHandleForReading.readabilityHandler = nil
                self?.lock.lock(); self?.processes.removeValue(forKey: id); self?.lock.unlock()
                self?.emit(["id": id, "type": "done", "code": Int(finished.terminationStatus)])
            }
            lock.lock(); processes[id] = process; lock.unlock()
            try process.run()
        } catch { emit(["id": id, "type": "error", "message": String(describing: error)]) }
    }

    private func valid(path: String) -> Bool { !path.isEmpty && !path.hasPrefix("/") && !path.contains("\\") && !path.split(separator: "/").contains("..") && path.count <= 240 }
    private func escape(_ value: String) -> String { value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\"") }
    private func emit(_ value: [String: Any]) {
        guard JSONSerialization.isValidJSONObject(value), let data = try? JSONSerialization.data(withJSONObject: value), let json = String(data: data, encoding: .utf8) else { return }
        DispatchQueue.main.async { [weak self] in self?.webView?.evaluateJavaScript("window.__ynxDesktopEvent(\(json))") }
    }
    enum BridgeError: Error { case invalidRequest, invalidProject, noTargets }
}

final class AppDelegate: NSObject, NSApplicationDelegate, WKNavigationDelegate {
    private var window: NSWindow!
    private var webView: WKWebView!
    private var bridge: CommandBridge!
    private var server: Process?

    func applicationDidFinishLaunching(_ notification: Notification) {
        let configuration = WKWebViewConfiguration(); let controller = WKUserContentController()
        let bridgeScript = #"""
        (() => {
          const jobs = new Map();
          window.__ynxDesktopEvent = (event) => { const job = jobs.get(event.id); if (!job) return; if (event.type === 'chunk') job.onChunk(event.text); if (event.type === 'done') { jobs.delete(event.id); job.resolve({code:event.code}); } if (event.type === 'error') { jobs.delete(event.id); job.reject(new Error(event.message)); } };
          globalThis.ynxDesktop = { executeApprovedCommand(payload, options={}) { return new Promise((resolve,reject) => { const id = crypto.randomUUID(); jobs.set(id,{resolve,reject,onChunk:options.onChunk||(()=>{})}); options.signal?.addEventListener('abort',()=>window.webkit.messageHandlers.command.postMessage({action:'cancel',id}),{once:true}); window.webkit.messageHandlers.command.postMessage({action:'run',id,payload}); }); } };
        })();
        """#
        controller.addUserScript(WKUserScript(source: bridgeScript, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        configuration.userContentController = controller
        webView = WKWebView(frame: .zero, configuration: configuration); bridge = CommandBridge(webView: webView); controller.add(bridge, name: "command")
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1440, height: 900), styleMask: [.titled,.closable,.miniaturizable,.resizable], backing: .buffered, defer: false)
        window.title = "YNX Developer Local — unsigned package"; window.contentView = webView; window.center(); window.makeKeyAndOrderFront(nil)
        launchServer(); loadWhenReady(attempt: 0)
    }

    private func launchServer() {
        guard let resources = Bundle.main.resourceURL else { return }
        let process = Process(); process.executableURL = URL(fileURLWithPath: "/usr/bin/env"); process.arguments = ["node", resources.appendingPathComponent("server.mjs").path]
        var environment = ProcessInfo.processInfo.environment; environment["PORT"] = "4177"; process.environment = environment
        process.standardOutput = FileHandle.nullDevice; process.standardError = FileHandle.nullDevice; try? process.run(); server = process
    }
    private func loadWhenReady(attempt: Int) {
        guard attempt < 40 else { return }
        let url = URL(string: "http://127.0.0.1:4177")!; let request = URLRequest(url: url, cachePolicy: .reloadIgnoringLocalCacheData, timeoutInterval: 1)
        URLSession.shared.dataTask(with: request) { [weak self] _, response, _ in
            DispatchQueue.main.async { if (response as? HTTPURLResponse)?.statusCode == 200 { self?.webView.load(URLRequest(url: url)) } else { DispatchQueue.main.asyncAfter(deadline: .now() + 0.15) { self?.loadWhenReady(attempt: attempt + 1) } } }
        }.resume()
    }
    func applicationWillTerminate(_ notification: Notification) { server?.terminate() }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
}

if CommandLine.arguments.contains("--self-test") {
    guard let resources = Bundle.main.resourceURL,
          FileManager.default.fileExists(atPath: resources.appendingPathComponent("web/index.html").path) else { exit(2) }
    print("YNX Developer unsigned local package resources OK"); exit(0)
}
let app = NSApplication.shared; let delegate = AppDelegate(); app.delegate = delegate; app.setActivationPolicy(.regular); app.activate(ignoringOtherApps: true); app.run()
