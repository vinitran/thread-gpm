import Cocoa
import Darwin

let appID = "com.hoanxu.gpm-tool"
let fm = FileManager.default

func run(_ executable: String, _ args: [String]) throws -> String {
    let p = Process(), pipe = Pipe()
    p.executableURL = URL(fileURLWithPath: executable); p.arguments = args
    p.standardOutput = pipe; p.standardError = pipe
    try p.run()
    let data = pipe.fileHandleForReading.readDataToEndOfFile(); p.waitUntilExit()
    if p.terminationStatus != 0 { throw NSError(domain: "HoanXu", code: Int(p.terminationStatus), userInfo: [NSLocalizedDescriptionKey: "Không chạy được \(URL(fileURLWithPath: executable).lastPathComponent)."]) }
    return String(data: data, encoding: .utf8) ?? ""
}
func inside(_ item: URL, _ parent: URL) -> Bool {
    return item.resolvingSymlinksInPath().path.hasPrefix(parent.resolvingSymlinksInPath().path + "/")
}
func installUpdate(_ args: [String]) throws {
    guard args.count == 7, let oldPID = Int32(args[3]) else { throw NSError(domain: "HoanXu", code: 1) }
    let source = URL(fileURLWithPath: args[1]), target = URL(fileURLWithPath: args[2]), data = URL(fileURLWithPath: args[4])
    let updates = data.appendingPathComponent("updates")
    guard inside(source, updates), source.lastPathComponent == "HoanXu GPM.app", target.pathExtension == "app", !target.path.hasPrefix("/Volumes/") else { throw NSError(domain: "HoanXu", code: 2) }
    _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", source.path])
    guard let bundle = Bundle(url: source), bundle.bundleIdentifier == appID, bundle.infoDictionary?["CFBundleShortVersionString"] as? String == args[5] else { throw NSError(domain: "HoanXu", code: 3) }
    for _ in 0..<300 { if kill(oldPID, 0) != 0 { break }; usleep(100_000) }
    if kill(oldPID, 0) == 0 { throw NSError(domain: "HoanXu", code: 4, userInfo: [NSLocalizedDescriptionKey: "App cũ chưa thoát. Chưa thay đổi app."]) }
    let parent = target.deletingLastPathComponent(), nonce = UUID().uuidString
    let next = parent.appendingPathComponent(".HoanXu-next-\(nonce).app"), backup = parent.appendingPathComponent(".HoanXu-backup-\(nonce).app")
    try fm.copyItem(at: source, to: next)
    do {
        _ = try run("/usr/bin/codesign", ["--verify", "--deep", "--strict", next.path])
        try fm.moveItem(at: target, to: backup)
        do { try fm.moveItem(at: next, to: target) }
        catch { try fm.moveItem(at: backup, to: target); throw error }
        // Launch failure rolls the installation back; the user's data folder is never moved.
        do { if args[6] != "no-open" {
            let restart = Process(); restart.executableURL = target.appendingPathComponent("Contents/MacOS/HoanXuGPM")
            var environment = ProcessInfo.processInfo.environment; environment["GPM_TOOL_DATA"] = data.path; restart.environment = environment
            restart.standardOutput = FileHandle.nullDevice; restart.standardError = FileHandle.nullDevice; try restart.run()
        } }
        catch { try? fm.removeItem(at: target); try fm.moveItem(at: backup, to: target); throw error }
        try? fm.removeItem(at: backup)
        try? fm.removeItem(at: source.deletingLastPathComponent())
        try? fm.removeItem(at: data.appendingPathComponent("update-install.json"))
        try? fm.removeItem(at: data.appendingPathComponent("update-error.txt"))
    } catch { try? fm.removeItem(at: next); throw error }
}


class AppDelegate: NSObject, NSApplicationDelegate {
    var server: Process?, window: NSWindow!, status: NSTextField!, address: String?, quitting = false
    var data: URL!, app: URL!, output = "", reused = false
    var tray: NSStatusItem!, termSignal: DispatchSourceSignal?
    var desktop: DesktopController!
    func applicationDidFinishLaunching(_ notification: Notification) {
        app = Bundle.main.bundleURL
        let env = ProcessInfo.processInfo.environment
        data = env["GPM_TOOL_DATA"].map { URL(fileURLWithPath: $0) } ?? fm.homeDirectoryForCurrentUser.appendingPathComponent("Library/Application Support/HoanXu-GPM/data")
        do { try fm.createDirectory(at: data, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700]) } catch { showError(error.localizedDescription); return }
        makeUI()
        signal(SIGTERM, SIG_IGN)
        termSignal = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        termSignal?.setEventHandler { NSApp.terminate(nil) }; termSignal?.resume()
        let port = env["PORT"] ?? "0"
        guard UInt16(port) != nil else { showError("Cổng chạy tool không hợp lệ."); return }
        // Reuse only a server owned by this app's data directory.
        if let bytes = try? Data(contentsOf: data.appendingPathComponent("app-runtime.json")), let saved = try? JSONSerialization.jsonObject(with: bytes) as? [String: Any], let pid = saved["pid"] as? Int32, let url = saved["address"] as? String, kill(pid, 0) == 0 {
            reused = true; address = url; desktop.connect(url); return
        }
        startServer(port)
    }
    func makeUI() {
        let menu = NSMenu(), main = NSMenuItem(); menu.addItem(main)
        let submenu = NSMenu(); submenu.addItem(withTitle: "Hiện cửa sổ", action: #selector(openDashboard), keyEquivalent: "o").target = self
        submenu.addItem(NSMenuItem.separator()); submenu.addItem(withTitle: "Thoát Hoàn Xu", action: #selector(NSApplication.terminate(_:)), keyEquivalent: "q"); main.submenu = submenu; NSApp.mainMenu = menu
        tray = NSStatusBar.system.statusItem(withLength: NSStatusItem.variableLength); tray.button?.title = "H · GPM"; tray.menu = submenu.copy() as? NSMenu
        window = NSWindow(contentRect: NSRect(x:0,y:0,width:1120,height:820), styleMask:[.titled,.closable,.miniaturizable,.resizable], backing:.buffered, defer:false)
        window.title = "Hoàn Xu · GPM Tool"; window.center(); window.isReleasedWhenClosed = false
        desktop = DesktopController(); window.contentViewController = desktop; status = desktop.message; window.minSize = NSSize(width:1000,height:700); window.setContentSize(NSSize(width:1120,height:820)); window.center()
        window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true)
    }
    func startServer(_ port: String) {
        let resources = app.appendingPathComponent("Contents/Resources"), p = Process(), pipe = Pipe()
        p.executableURL = resources.appendingPathComponent("node"); p.arguments = [resources.appendingPathComponent("gpm-tool/server.mjs").path]; p.currentDirectoryURL = resources.appendingPathComponent("gpm-tool")
        var env = ProcessInfo.processInfo.environment; env["PORT"] = port; env["GPM_TOOL_DATA"] = data.path; env["GPM_TOOL_APP_PATH"] = app.path; p.environment = env; p.standardOutput = pipe; p.standardError = pipe
        let log = data.appendingPathComponent("app.log"); if !fm.fileExists(atPath:log.path) { fm.createFile(atPath:log.path,contents:nil,attributes:[.posixPermissions:0o600]) }
        let logHandle = try? FileHandle(forWritingTo:log); _ = try? logHandle?.seekToEnd()
        pipe.fileHandleForReading.readabilityHandler = { [weak self] handle in
            let bytes = handle.availableData; if bytes.isEmpty { return }; try? logHandle?.write(contentsOf:bytes)
            DispatchQueue.main.async {
                guard let self = self else { return }
                self.output = String((self.output + (String(data:bytes,encoding:.utf8) ?? "")).suffix(4000))
                if self.address == nil, let range = self.output.range(of:"GPM tool UI: http://127.0.0.1:"), let end = self.output[range.upperBound...].firstIndex(of:"\n") {
                    let url = String(self.output[range.lowerBound..<end]).replacingOccurrences(of:"GPM tool UI: ",with:"")
                    self.address = url; self.status.stringValue = "Tool đang chạy · \(url)\nMở GPM trước khi chạy profile."
                    if let b = try? JSONSerialization.data(withJSONObject:["pid":p.processIdentifier,"launcherPid":getpid(),"address":url]) { try? b.write(to:self.data.appendingPathComponent("app-runtime.json"), options:.atomic) }
                    self.desktop.connect(url)
                }
            }
        }
        p.terminationHandler = { [weak self] process in
            guard let self = self else { return }; pipe.fileHandleForReading.readabilityHandler = nil; try? logHandle?.close(); try? fm.removeItem(at:self.data.appendingPathComponent("app-runtime.json"))
            if process.terminationStatus == 42 {
                do { try self.spawnUpdater(); self.quitting = true; exit(0) }
                catch { DispatchQueue.main.async { self.showError("Không mở được bộ cài cập nhật. App cũ còn nguyên.\n" + error.localizedDescription) } }
            } else if self.quitting { exit(0) }
            else { DispatchQueue.main.async { self.showError("Tool đã thoát. Xem app.log trong thư mục dữ liệu để biết nguyên nhân.") } }
        }
        do { try p.run(); server = p } catch { showError(error.localizedDescription) }
    }
    func spawnUpdater() throws {
        let bytes = try Data(contentsOf:data.appendingPathComponent("update-install.json")), request = try JSONSerialization.jsonObject(with:bytes) as? [String:Any]
        guard let source = request?["source"] as? String, let target = request?["target"] as? String, let version = request?["version"] as? String, target == app.path else { throw NSError(domain:"HoanXu",code:5) }
        let helper = data.appendingPathComponent("updates/helper-\(UUID().uuidString)"); try fm.copyItem(at:app.appendingPathComponent("Contents/MacOS/HoanXuGPM"),to:helper)
        let p = Process(); p.executableURL = helper; p.arguments = ["--install-update",source,target,String(getpid()),data.path,version,"open"]
        p.standardOutput = FileHandle.nullDevice; p.standardError = FileHandle.nullDevice; try p.run()
    }
    @objc func openDashboard() { window.makeKeyAndOrderFront(nil); NSApp.activate(ignoringOtherApps:true) }
    func showError(_ message: String) { if window == nil { makeUI() }; status.stringValue = message }
    func applicationShouldTerminate(_ sender: NSApplication) -> NSApplication.TerminateReply {
        if let p = server, p.isRunning { if !quitting { quitting = true; p.terminate() }; return .terminateLater }; return .terminateNow
    }
}
