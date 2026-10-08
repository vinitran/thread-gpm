import Cocoa
import Darwin

if CommandLine.arguments.count > 1 && CommandLine.arguments[1] == "--install-update" {
    let args = Array(CommandLine.arguments.dropFirst())
    do { try installUpdate(args); exit(0) }
    catch {
        if args.count > 4 { try? error.localizedDescription.write(toFile: URL(fileURLWithPath: args[4]).appendingPathComponent("update-error.txt").path, atomically: true, encoding: .utf8) }
        fputs("Cập nhật không hoàn tất. App cũ và dữ liệu được giữ.\n", stderr); exit(1)
    }
}

let application = NSApplication.shared
let delegate = AppDelegate(); application.delegate = delegate; application.setActivationPolicy(.regular); application.run()
