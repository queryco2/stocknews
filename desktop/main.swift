import Cocoa
import WebKit

final class Desktop: NSObject, NSApplicationDelegate, WKNavigationDelegate, WKUIDelegate {
    var window: NSWindow!
    var web: WKWebView!
    var backend: Process?
    var baseURL: URL?
    var output = Data()
    var ready = false
    func applicationDidFinishLaunching(_ notification: Notification) {
        let menu = NSMenu()
        let item = NSMenuItem(); menu.addItem(item)
        let appMenu = NSMenu(); item.submenu = appMenu
        appMenu.addItem(withTitle: "退出 Stocknews", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q")
        let editItem = NSMenuItem(); menu.addItem(editItem)
        let edit = NSMenu(title: "编辑"); editItem.submenu = edit
        for (title, action, key) in [("撤销", "undo:", "z"), ("剪切", "cut:", "x"), ("复制", "copy:", "c"), ("粘贴", "paste:", "v"), ("全选", "selectAll:", "a")] {
            edit.addItem(withTitle: title, action: Selector(action), keyEquivalent: key)
        }
        NSApp.mainMenu = menu
        window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 1280, height: 820), styleMask: [.titled, .closable, .miniaturizable, .resizable], backing: .buffered, defer: false)
        window.title = "Stocknews"; window.minSize = NSSize(width: 800, height: 600)
        web = WKWebView(); web.navigationDelegate = self; web.uiDelegate = self
        window.contentView = web; window.center(); window.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        web.loadHTMLString("<body style='font:18px -apple-system;padding:48px'>正在启动…</body>", baseURL: nil)
        startBackend()
    }
    func startBackend() {
        let resources = Bundle.main.resourceURL!
        let root = resources.appendingPathComponent("workspace")
        let data = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/Stocknews")
        do {
            try FileManager.default.createDirectory(at: data, withIntermediateDirectories: true)
            let task = Process(); backend = task
            task.executableURL = resources.appendingPathComponent("runtime/node")
            task.arguments = [root.appendingPathComponent("app/server/index.ts").path]
            task.currentDirectoryURL = root
            var env = ProcessInfo.processInfo.environment
            env["STOCKNEWS_DATA_DIR"] = data.path; env["PORT"] = "0"
            env["STOCKNEWS_DESKTOP"] = "1"
            env["PATH"] = "/usr/local/bin:/opt/homebrew/bin:/usr/bin:/bin:" + (env["PATH"] ?? "")
            task.environment = env
            let pipe = Pipe(); task.standardOutput = pipe
            let log = data.appendingPathComponent("desktop.log")
            if !FileManager.default.fileExists(atPath: log.path) { FileManager.default.createFile(atPath: log.path, contents: nil) }
            let handle = try FileHandle(forWritingTo: log); try handle.seekToEnd(); task.standardError = handle
            pipe.fileHandleForReading.readabilityHandler = { [weak self] stream in
                let bytes = stream.availableData
                guard !bytes.isEmpty else { return }
                DispatchQueue.main.async {
                    guard let self = self, !self.ready else { return }
                    self.output.append(bytes)
                    let text = String(decoding: self.output, as: UTF8.self)
                    for line in text.components(separatedBy: "\n") where line.hasPrefix("Stocknews API http://127.0.0.1:") {
                        if let url = URL(string: String(line.dropFirst("Stocknews API ".count))) {
                            self.ready = true; self.baseURL = url; self.web.load(URLRequest(url: url))
                        }
                    }
                }
            }
            task.terminationHandler = { [weak self] _ in DispatchQueue.main.async { self?.failed("本地服务已退出。请重新打开应用，日志位于 ~/Library/Application Support/Stocknews/desktop.log。") } }
            try task.run()
            DispatchQueue.main.asyncAfter(deadline: .now() + 30) { [weak self] in
                if self?.ready == false { self?.failed("启动超时，请重新打开应用并检查 desktop.log。") }
            }
        } catch { failed("无法启动本地服务：\(error.localizedDescription)") }
    }
    func failed(_ message: String) { let alert = NSAlert(); alert.messageText = "Stocknews"; alert.informativeText = message; alert.runModal() }
    func webView(_ webView: WKWebView, decidePolicyFor navigationAction: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = navigationAction.request.url else { decisionHandler(.cancel); return }
        if url.scheme == "about" || (url.scheme == baseURL?.scheme && url.host == baseURL?.host && url.port == baseURL?.port) { decisionHandler(.allow); return }
        if ["https", "http", "workbuddy", "obsidian"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }
        decisionHandler(.cancel)
    }
    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for navigationAction: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = navigationAction.request.url, ["https", "http"].contains(url.scheme ?? "") { NSWorkspace.shared.open(url) }; return nil
    }
    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool { true }
    func applicationWillTerminate(_ notification: Notification) { backend?.terminationHandler = nil; backend?.terminate() }
}
let application = NSApplication.shared
let delegate = Desktop()
application.delegate = delegate
application.setActivationPolicy(.regular)
application.run()
