import Cocoa

// Compile with Launcher.swift and Desktop.swift. Uses only in-memory fixtures, no backend/GPM.
@main struct LogRenderingCheck {
    static func main() {
        let app = NSApplication.shared; app.setActivationPolicy(.accessory)
        let controller = DesktopController()
        let window = NSWindow(contentRect:NSRect(x:0,y:0,width:1100,height:800),styleMask:[.titled,.resizable],backing:.buffered,defer:false)
        window.contentViewController = controller
        window.setContentSize(NSSize(width:1100,height:800))
        window.appearance = NSAppearance(named:.darkAqua)
        controller.profiles = [["id":"fixture","name":"Profile fixture","view":[
            "logs":(0..<100).map { ["time":"2026-10-08T01:00:00Z","message":"Nhật ký dòng \($0)"] },
            "recent":[["created_at":"2026-10-08T01:00:00Z","state":"sent_unverified","post_url":"https://www.threads.com/@fixture/post/test"]]
        ]]]
        controller.renderLogs() // Load while the log tab is hidden, as in production.
        controller.tabs.selectTabViewItem(at:2); window.makeKeyAndOrderFront(nil)
        RunLoop.current.run(until:Date().addingTimeInterval(0.2))
        window.contentView?.layoutSubtreeIfNeeded()
        for text in [controller.logs,controller.history] {
            assert(text.string.contains("Profile fixture"))
            assert(text.textStorage?.attribute(.foregroundColor,at:0,effectiveRange:nil) != nil)
            assert(text.bounds.width > 100 && text.visibleRect.height > 20)
            assert(text.textContainer!.widthTracksTextView)
            text.layoutManager!.ensureLayout(for:text.textContainer!)
            assert(text.layoutManager!.usedRect(for:text.textContainer!).height > 0)
        }
        controller.logs.enclosingScrollView!.contentView.scroll(to:NSPoint(x:0,y:100))
        let previous = controller.logs.enclosingScrollView!.contentView.bounds.origin
        controller.renderLogs()
        assert(controller.logs.enclosingScrollView!.contentView.bounds.origin == previous)
        window.close()
        print("PASS: macOS hidden-tab log rendering, explicit text color, layout and scroll preservation")
    }
}
