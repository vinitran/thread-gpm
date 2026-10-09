import Cocoa
import UniformTypeIdentifiers

typealias JSONObject = [String: Any]
func object(_ value: Any?) -> JSONObject { value as? JSONObject ?? [:] }
func string(_ value: Any?) -> String { guard let value = value, !(value is NSNull) else { return "" }; return String(describing:value) }
func objects(_ value: Any?) -> [JSONObject] { value as? [JSONObject] ?? [] }
func failure(_ message: String) -> NSError { NSError(domain: "HoanXu", code: 1, userInfo: [NSLocalizedDescriptionKey: message]) }

final class ToolAPI {
    let base: URL
    var token = ""
    init(_ address: String) { base = URL(string: address)! }
    func request(_ route: String, _ body: JSONObject? = nil, retry: Bool = true) async throws -> JSONObject {
        if body != nil && token.isEmpty { _ = try await request("state") }
        var request = URLRequest(url: URL(string:"/api/" + route,relativeTo:base)!.absoluteURL); request.timeoutInterval = 360
        if let body = body {
            request.httpMethod = "POST"; request.httpBody = try JSONSerialization.data(withJSONObject: body)
            request.setValue("application/json", forHTTPHeaderField: "Content-Type")
            request.setValue(base.absoluteString, forHTTPHeaderField: "Origin"); request.setValue(token, forHTTPHeaderField: "X-Tool-Token")
        }
        let (data, response) = try await URLSession.shared.data(for: request)
        let json = object(try JSONSerialization.jsonObject(with: data)), code = (response as? HTTPURLResponse)?.statusCode ?? 0
        if code == 403 && retry && string(json["error"]) == "Invalid origin/token" { _ = try await self.request("state"); return try await self.request(route, body, retry: false) }
        guard (200..<300).contains(code) else { throw failure(string(json["error"]).isEmpty ? "Không kết nối được tool." : string(json["error"])) }
        if route == "state" { token = string(json["token"]) }
        return json
    }
}

final class CallbackButton: NSButton {
    var callback: (() -> Void)?
    init(_ title: String, callback: @escaping () -> Void) { super.init(frame:.zero); self.title = title; self.callback = callback; bezelStyle = .rounded; target = self; action = #selector(invoke) }
    required init?(coder: NSCoder) { fatalError("init(coder:) not supported") }
    @objc func invoke() { callback?() }
}
final class FormStack: NSStackView { override var isFlipped: Bool { true } }

final class ToggleTable: NSTableView {
    override func mouseDown(with event: NSEvent) {
        let row = self.row(at: convert(event.locationInWindow, from: nil))
        if row >= 0 && event.clickCount == 1 {
            if selectedRowIndexes.contains(row) { deselectRow(row) } else { selectRowIndexes(IndexSet(integer: row), byExtendingSelection: true) }
        } else { super.mouseDown(with: event) }
    }
}

final class DesktopController: NSViewController, NSTableViewDataSource, NSTableViewDelegate, NSSearchFieldDelegate {
    var api: ToolAPI?, snapshot: JSONObject = [:], profiles: [JSONObject] = [], visible: [JSONObject] = [], selected = Set<String>()
    var busy = 0, refreshing = false, loadedSettings = false, dirty = false, selecting = false, poll: Timer?, openEpoch = 0
    let table = ToggleTable(), search = NSSearchField(), filter = NSPopUpButton(), tabs = NSTabView()
    let message = NSTextField(wrappingLabelWithString: "Đang khởi động…"), selection = NSTextField(labelWithString: "Chưa chọn profile"), spinner = NSProgressIndicator()
    let logs = NSTextView(), history = NSTextView(), prompt = NSTextView(), updateText = NSTextField(wrappingLabelWithString: ""), saved = NSTextField(wrappingLabelWithString: "")
    var inputs: [String: NSTextField] = [:], checks: [String: NSButton] = [:], buttons: [String: NSButton] = [:]
    let updateBanner = NSStackView(), updateWarning = NSTextField(wrappingLabelWithString:""), versionText = NSTextField(labelWithString:"Phiên bản…")
    var updateChecking = false, lastUpdateCheck = Date.distantPast
    var tableSignature = "", editingProfileForm = false
    var picker: ProfilePicker?, updater: JSONObject = [:]
    override func loadView() {
        view = NSView(); view.identifier = NSUserInterfaceItemIdentifier("native-workspace")
        let root = NSStackView(); root.orientation = .vertical; root.alignment = .leading; root.spacing = 16; root.distribution = .fill
        pin(root, in: view, inset: 22)
        let title = NSTextField(labelWithString: "Hoàn Xu · Threads Workspace"); title.font = .boldSystemFont(ofSize: 24)
        let subtitle = NSTextField(labelWithString: "Thêm profile → mở để kiểm tra đăng nhập → lưu cài đặt → chạy tự động"); subtitle.textColor = .secondaryLabelColor
        root.addArrangedSubview(title); root.addArrangedSubview(subtitle)
        addWide(row([versionText,button("Kiểm tra cập nhật","check-update-top",#selector(checkUpdate))]),to:root)
        updateBanner.orientation = .horizontal; updateBanner.alignment = .centerY; updateBanner.spacing = 12; updateWarning.textColor = .systemOrange; updateWarning.setContentCompressionResistancePriority(.defaultLow,for:.horizontal); updateBanner.addArrangedSubview(updateWarning); updateBanner.addArrangedSubview(button("Cập nhật & mở lại","install-update-top",#selector(installUpdate))); updateBanner.isHidden = true; addWide(updateBanner,to:root)
        tabs.setContentHuggingPriority(.defaultLow, for: .vertical); tabs.setContentCompressionResistancePriority(.defaultLow, for: .vertical); tabs.tabViewType = .topTabsBezelBorder; tabs.identifier = NSUserInterfaceItemIdentifier("workspace-tabs")
        root.addArrangedSubview(tabs); tabs.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true; tabs.heightAnchor.constraint(greaterThanOrEqualToConstant:360).isActive = true
        let profilesPage = column(), settingsPage = column(), logPage = column()
        tab("Profile", profilesPage); tab("Cài đặt chung", settingsPage); tab("Nhật ký & lịch sử", logPage)
        buildProfiles(profilesPage); buildSettings(settingsPage); buildLogs(logPage)
        spinner.style = .spinning; spinner.controlSize = .small; spinner.isDisplayedWhenStopped = false
        let feedback = row([spinner,message]); feedback.heightAnchor.constraint(greaterThanOrEqualToConstant: 36).isActive = true
        root.addArrangedSubview(feedback); feedback.widthAnchor.constraint(equalTo: root.widthAnchor).isActive = true
        message.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        spinner.startAnimation(nil); controls()
    }
    func connect(_ address: String) {
        api = ToolAPI(address); message.stringValue = "Đã mở app · đang tải dữ liệu…"
        Task { @MainActor in await refresh(); await loadUpdate(); if busy == 0 { spinner.stopAnimation(nil) } }
        poll?.invalidate(); poll = Timer.scheduledTimer(withTimeInterval: 2, repeats: true) { [weak self] _ in Task { @MainActor in await self?.refresh(); if let self = self, Date().timeIntervalSince(self.lastUpdateCheck) >= 3600 { await self.checkForUpdate() } } }
    }
    func showMessage(_ text: String, error: Bool = false) { message.stringValue = text; message.textColor = error ? .systemRed : .secondaryLabelColor }
    func tab(_ title: String, _ content: NSView) { let item = NSTabViewItem(identifier: title); item.label = title; let host = NSView(); pin(content, in: host, inset: 16); item.view = host; tabs.addTabViewItem(item) }
    func column() -> NSStackView { let s = FormStack(); s.orientation = .vertical; s.alignment = .leading; s.spacing = 12; return s }
    func row(_ items: [NSView]) -> NSStackView { let s = NSStackView(views: items); s.orientation = .horizontal; s.alignment = .centerY; s.spacing = 9; return s }
    func pin(_ item: NSView, in parent: NSView, inset: CGFloat = 0) { parent.addSubview(item); item.translatesAutoresizingMaskIntoConstraints = false; NSLayoutConstraint.activate([item.leadingAnchor.constraint(equalTo:parent.leadingAnchor,constant:inset),item.trailingAnchor.constraint(equalTo:parent.trailingAnchor,constant:-inset),item.topAnchor.constraint(equalTo:parent.topAnchor,constant:inset),item.bottomAnchor.constraint(equalTo:parent.bottomAnchor,constant:-inset)]) }
    func button(_ title: String, _ key: String, _ action: Selector) -> NSButton { let b = NSButton(title:title,target:self,action:action); b.bezelStyle = .rounded; b.identifier = NSUserInterfaceItemIdentifier(key); buttons[key] = b; return b }
    func label(_ title: String) -> NSTextField { let l = NSTextField(wrappingLabelWithString:title); l.textColor = .secondaryLabelColor; return l }
    func scroll(_ document: NSView, height: CGFloat? = nil) -> NSScrollView {
        let s = NSScrollView(); s.hasVerticalScroller = true; s.autohidesScrollers = true; s.borderType = .bezelBorder
        if let text = document as? NSTextView {
            text.minSize = .zero; text.maxSize = NSSize(width:CGFloat.greatestFiniteMagnitude,height:CGFloat.greatestFiniteMagnitude)
            text.isVerticallyResizable = true; text.isHorizontallyResizable = false; text.autoresizingMask = [.width]
            text.textContainer?.widthTracksTextView = true
            text.textContainer?.containerSize = NSSize(width:0,height:CGFloat.greatestFiniteMagnitude)
            text.textColor = .textColor; text.backgroundColor = .textBackgroundColor
            text.textContainerInset = NSSize(width:10,height:8)
        }
        s.documentView = document
        if let height = height { s.heightAnchor.constraint(equalToConstant:height).isActive = true }
        return s
    }
    func updateLogText(_ text: NSTextView, _ value: String) {
        guard text.string != value else { return }
        let position = text.enclosingScrollView?.contentView.bounds.origin ?? .zero
        text.textStorage?.setAttributedString(NSAttributedString(string:value,attributes:[.font:NSFont.monospacedSystemFont(ofSize:12,weight:.regular),.foregroundColor:NSColor.textColor]))
        text.layoutManager?.ensureLayout(for:text.textContainer!)
        text.sizeToFit()
        text.enclosingScrollView?.contentView.scroll(to:position)
        text.needsDisplay = true
    }
    func addWide(_ child: NSView, to parent: NSStackView) { parent.addArrangedSubview(child); child.widthAnchor.constraint(equalTo:parent.widthAnchor).isActive = true }
    func buildProfiles(_ page: NSStackView) {
        addWide(row([button("Từ GPM…","pick-gpm",#selector(pickGpm)),button("Tạo mới…","create-profile",#selector(createProfile)),button("Nhập file…","import-file",#selector(importFile)),button("Xuất / chuyển máy…","export-profiles",#selector(exportProfiles))]),to:page)
        search.placeholderString = "Tìm theo tên hoặc ID"; search.delegate = self; search.identifier = NSUserInterfaceItemIdentifier("profile-search")
        filter.addItems(withTitles:["Tất cả","Đang chạy","Đang nghỉ","Cần kiểm tra","Đã dừng"]); filter.target = self; filter.action = #selector(filterChanged)
        let tools = row([search,filter,button("Chọn tất cả","select-all",#selector(selectAllProfiles)),button("Bỏ chọn","clear-selection",#selector(clearSelection))]); search.widthAnchor.constraint(greaterThanOrEqualToConstant:300).isActive = true; addWide(tools,to:page)
        table.identifier = NSUserInterfaceItemIdentifier("profiles-table"); table.delegate = self; table.dataSource = self; table.allowsMultipleSelection = true; table.rowHeight = 48; table.usesAlternatingRowBackgroundColors = true; table.columnAutoresizingStyle = .lastColumnOnlyAutoresizingStyle
        for (key,title,width) in [("name","Profile",220.0),("proxy","Proxy",185.0),("status","Trạng thái / thao tác",350.0),("counts","Hôm nay / tổng",130.0)] { let c = NSTableColumn(identifier:NSUserInterfaceItemIdentifier(key)); c.title = title; c.width = width; c.minWidth = 80; table.addTableColumn(c) }
        addWide(scroll(table),to:page)
        addWide(row([selection,button("Mở trình duyệt","open-selected",#selector(openSelected)),button("Chạy thử · không đăng","dry-run-selected",#selector(dryRunSelected)),button("Dừng & đóng","stop-selected",#selector(stopSelected))]),to:page)
        addWide(row([button("Chạy tự động","start-selected",#selector(startSelected)),button("Chạy bằng extension","start-extension",#selector(startExtensionSelected)),label("Extension tự được nạp vào profile · dùng cùng cài đặt và lịch sử")]),to:page)
        addWide(row([button("Sửa tên / proxy…","edit-profile",#selector(editProfile)),button("Xóa khỏi GPM…","delete-profile",#selector(deleteProfile)),label("Bấm dòng để chọn/bỏ chọn · Mở chỉ mở GPM, chưa chạy tự động")]),to:page)
        table.setContentHuggingPriority(.defaultLow,for:.vertical)
    }
    func field(_ title: String, _ key: String, value: String = "", secure: Bool = false, width: CGFloat = 200) -> NSView {
        let stack = column(); stack.spacing = 5; stack.addArrangedSubview(label(title)); let input: NSTextField = secure ? NSSecureTextField(string:value) : NSTextField(string:value)
        input.identifier = NSUserInterfaceItemIdentifier(key); input.delegate = self; inputs[key] = input; stack.addArrangedSubview(input); input.widthAnchor.constraint(equalTo:stack.widthAnchor).isActive = true; stack.widthAnchor.constraint(greaterThanOrEqualToConstant:width).isActive = true; return stack
    }
    func buildSettings(_ page: NSStackView) {
        addWide(row([label("Dùng chung cho tất cả profile, kể cả profile thêm mới"),button("Lưu cho tất cả profile","save-settings",#selector(saveSettings))]),to:page)
        saved.font = .systemFont(ofSize:12); addWide(saved,to:page)
        let form = column(); form.spacing = 14
        addWide(field("GPM Local API · đúng địa chỉ trong cài đặt GPM","gpmApi",width:600),to:form)
        addWide(row([button("Kiểm tra / tìm GPM","check-gpm",#selector(checkGpm)),label("Mở GPM trước · tìm cổng 9495 hoặc 19995")]),to:form)
        addWide(row([field("Model AI","model",width:270),field("API key · để trống để giữ key đã lưu","apiKey",secure:true,width:300),button("Tải model…","load-models",#selector(loadModels))]),to:form)
        addWide(field("Chủ đề muốn tìm · phân cách bằng dấu phẩy","keywords",width:600),to:form)
        addWide(row([field("Nghỉ trung bình · giây (±20%)","restAverageSeconds"),field("Gõ mỗi ký tự · ms","typingDelayMs"),field("Chờ giữa thao tác · giây","stepSeconds")]),to:form)
        addWide(row([field("Chờ tìm bài mới · giây","searchDelaySeconds"),field("Folder ảnh · trống dùng ảnh đi kèm","imagesFolder",width:330),button("Chọn folder…","choose-images",#selector(chooseImages))]),to:form)
        let idle = NSButton(checkboxWithTitle:"Cuộn nhẹ khi nghỉ",target:self,action:#selector(settingsEdited)), likes = NSButton(checkboxWithTitle:"Thả tim khi chờ · ngẫu nhiên 2–5 bài",target:self,action:#selector(settingsEdited)); checks["idleScroll"] = idle; checks["idleEngagement"] = likes; addWide(row([idle,likes]),to:form)
        let tag = NSButton(checkboxWithTitle:"Tag @hoanxu.app · sau mỗi 4 bài ảnh, thêm 1 bài chữ có tag",target:self,action:#selector(settingsEdited)); checks["tagHoanxu"] = tag; addWide(tag,to:form)
        form.addArrangedSubview(label("Hướng dẫn cho AI (prompt)")); prompt.identifier = NSUserInterfaceItemIdentifier("prompt"); prompt.font = .systemFont(ofSize:13); prompt.isRichText = false; prompt.isAutomaticQuoteSubstitutionEnabled = false
        NotificationCenter.default.addObserver(self,selector:#selector(settingsEdited),name:NSText.didChangeNotification,object:prompt)
        addWide(scroll(prompt,height:230),to:form)
        addWide(row([button("Nhập prompt .txt…","import-prompt",#selector(importPrompt)),button("Kiểm tra ảnh","check-images",#selector(checkImages))]),to:form)
        form.addArrangedSubview(label("Bấm Lưu để áp dụng model, chủ đề và nhịp chạy từ bước tiếp theo. Lượt AI/comment đang làm sẽ hoàn tất."))
        let line = NSBox(); line.boxType = .separator; addWide(line,to:form)
        addWide(row([button("Kiểm tra cập nhật","check-update",#selector(checkUpdate)),button("Cài bản mới & mở lại","install-update",#selector(installUpdate))]),to:form); addWide(updateText,to:form)
        let sc = scroll(form); sc.drawsBackground = false; addWide(sc,to:page); form.translatesAutoresizingMaskIntoConstraints = false; form.widthAnchor.constraint(equalTo:sc.contentView.widthAnchor,constant:-18).isActive = true
    }
    func buildLogs(_ page: NSStackView) {
        page.addArrangedSubview(label("Nhật ký tất cả profile · Lịch sử gần đây tự cập nhật"))
        for text in [logs,history] { text.isEditable = false; text.isRichText = false; text.font = .monospacedSystemFont(ofSize:12,weight:.regular); text.isVerticallyResizable = true }
        addWide(scroll(logs),to:page); addWide(row([button("Làm mới nhật ký & lịch sử","load-history",#selector(loadHistory)),button("Mở thư mục dữ liệu","open-data",#selector(openData))]),to:page); addWide(scroll(history,height:130),to:page)
    }
    func controlTextDidChange(_ notification: Notification) { if notification.object as? NSSearchField === search { renderProfiles() } else { settingsEdited() } }
    @objc func settingsEdited() { dirty = true; saved.stringValue = "Có thay đổi chưa lưu"; saved.textColor = .systemOrange }
    func setBusy(_ delta: Int) { busy += delta; if busy > 0 { spinner.startAnimation(nil) } else { spinner.stopAnimation(nil) }; controls() }
    func controls() {
        let any = !selected.isEmpty, one = selected.count == 1, ready = api != nil && loadedSettings
        for (key,b) in buttons { b.isEnabled = ready && busy == 0; if ["open-selected","start-selected","start-extension"].contains(key) { b.isEnabled = ready && any && busy == 0 }; if key == "stop-selected" { b.isEnabled = ready && any }; if ["edit-profile","delete-profile","dry-run-selected"].contains(key) { b.isEnabled = ready && one && busy == 0 } }
        for key in ["install-update","install-update-top"] { buttons[key]?.isEnabled = ready && busy == 0 && !updateChecking && (updater["available"] as? Bool == true) && (updater["installSupported"] as? Bool == true) }
        for key in ["check-update","check-update-top"] { buttons[key]?.isEnabled = ready && busy == 0 && !updateChecking && !string(updater["repository"]).isEmpty }
        selection.stringValue = selected.isEmpty ? "Chưa chọn profile" : "Đã chọn \(selected.count) profile"
        for input in inputs.values { input.isEnabled = ready && busy == 0 }; for check in checks.values { check.isEnabled = ready && busy == 0 }; prompt.isEditable = ready && busy == 0
    }
    func perform(_ title: String, _ task: @escaping (ToolAPI) async throws -> String) {
        guard let api = api else { return }; setBusy(1); showMessage(title)
        Task { @MainActor in
            do { let result = try await task(api); showMessage(result); await refresh() } catch { showMessage(error.localizedDescription,error:true) }
            setBusy(-1)
        }
    }
    func refresh() async {
        guard let api = api, !refreshing, !editingProfileForm else { return }; refreshing = true; defer { refreshing = false }
        do { snapshot = try await api.request("state"); if editingProfileForm { return }; profiles = objects(snapshot["profiles"]); if !loadedSettings { loadSettings(object(snapshot["settings"])); loadedSettings = true; showMessage("Sẵn sàng · dữ liệu được lưu trên máy") }; renderProfiles(); renderLogs(); controls()
            let download = object(snapshot["updateDownload"])
            if ["downloading","verifying","ready"].contains(string(download["phase"])) { let text = string(download["message"]); showMessage(text); updateText.stringValue = text; updateWarning.stringValue = text }
        }
        catch { if busy == 0 { showMessage("Mất kết nối · đang thử lại: " + error.localizedDescription,error:true) } }
    }
    func loadSettings(_ value: JSONObject) {
        let config = object(value["runConfig"])
        for (key,input) in inputs { if key == "apiKey" { input.stringValue = "" } else if key == "keywords" || key.hasSuffix("Seconds") || key == "typingDelayMs" { input.stringValue = key == "restAverageSeconds" ? string(config[key] ?? ((config["minRestSeconds"] as? Double ?? 120) + (config["maxRestSeconds"] as? Double ?? 180)) / 2) : string(config[key]) } else { input.stringValue = string(value[key]) } }
        for (key,check) in checks { check.state = (config[key] as? Bool ?? (key == "idleEngagement")) ? .on : .off }
        prompt.string = string(value["prompt"]); dirty = false; saved.stringValue = "Đã lưu · áp dụng cho tất cả profile"; saved.textColor = .secondaryLabelColor
    }
    func settingsBody() throws -> JSONObject {
        var value = object(snapshot["settings"]), config = object(value["runConfig"])
        for (key,input) in inputs {
            if ["restAverageSeconds","typingDelayMs","stepSeconds","searchDelaySeconds"].contains(key) { guard let n = Double(input.stringValue), n.isFinite, n >= 0 else { throw failure("\(key): nhập số không âm.") }; config[key] = n }
            else if key == "keywords" { config[key] = input.stringValue } else { value[key] = input.stringValue.trimmingCharacters(in:.whitespacesAndNewlines) }
        }
        for (key,check) in checks { config[key] = check.state == .on }
        value["prompt"] = prompt.string; value["runConfig"] = config; value["scope"] = "all"; return value
    }
    @objc func checkGpm() { let base = inputs["gpmApi"]?.stringValue.trimmingCharacters(in:.whitespacesAndNewlines) ?? ""; perform("Đang kiểm tra GPM Local API…") { [weak self] api in let r = try await api.request("gpm-check",["gpmApi":base]); if r["discovered"] as? Bool == true { self?.inputs["gpmApi"]?.stringValue = string(r["gpmApi"]); self?.settingsEdited() }; return string(r["message"]) } }
    @objc func saveSettings() {
        do { let body = try settingsBody(); perform("Đang lưu cho tất cả profile…") { [weak self] api in
            let r = try await api.request("settings",body), failed = objects(r["results"]).filter { $0["ok"] as? Bool != true }
            if let self = self { self.snapshot["settings"] = r["settings"]; self.loadSettings(object(r["settings"])) }
            if !failed.isEmpty { throw failure("Đã lưu cấu hình chung, còn profile chưa áp dụng: " + failed.map { string($0["name"]) + ": " + string($0["error"]) }.joined(separator:" · ")) }
            return "Đã lưu cho tất cả profile · model " + string(object(r["settings"])["model"]) + " · dùng từ bước tiếp theo."
        } } catch { showMessage(error.localizedDescription,error:true) }
    }
    func category(_ p: JSONObject) -> String { let v = object(p["view"]),s = object(v["state"]),status = string(s["status"]); if status == "attention" || ["missing","unavailable"].contains(string(object(p["gpm"])["status"])) || !string(p["error"]).isEmpty || !string(v["error"]).isEmpty { return "Cần kiểm tra" }; if status == "running" || status == "stopping" { return ["resting","waiting","session-rest"].contains(string(object(s["activity"])["phase"])) ? "Đang nghỉ" : "Đang chạy" }; return "Đã dừng" }
    func profileStatus(_ p: JSONObject) -> String {
        let v = object(p["view"]), g = object(p["gpm"]), activity = string(object(object(v["state"])["activity"])["message"])
        let remote = g["fresh"] as? Bool == true && string(g["status"]) == "present" ? "GPM đã đồng bộ" : (string(g["error"]).isEmpty ? "GPM chưa đồng bộ" : string(g["error"]))
        return [category(p),remote,v["connected"] as? Bool == true ? "CDP đã kết nối" : "CDP chưa kết nối",string(p["error"]).isEmpty ? activity : string(p["error"])].filter { !$0.isEmpty }.joined(separator:" · ")
    }
    func renderProfiles() {
        selected.formIntersection(Set(profiles.map { string($0["id"]) })); let query = search.stringValue.lowercased(), choice = filter.titleOfSelectedItem ?? "Tất cả"
        visible = profiles.filter { p in (query.isEmpty || (string(p["name"]) + " " + string(p["id"])).lowercased().contains(query)) && (choice == "Tất cả" || category(p) == choice) }
        let signature = visible.map { p in string(p["id"]) + "|" + string(p["name"]) + "|" + string(p["proxy"]) + "|" + profileStatus(p) + "|" + string(p["error"]) + "|" + string(object(object(object(p["view"])["state"])["activity"])["message"]) + "|" + string(object(object(p["view"])["counts"])["today"]) + "|" + string(object(object(p["view"])["counts"])["total"]) }.joined(separator:"\n")
        selecting = true; if signature != tableSignature { tableSignature = signature; table.reloadData() }; let indexes = IndexSet(visible.indices.filter { selected.contains(string(visible[$0]["id"])) }); if indexes != table.selectedRowIndexes { table.selectRowIndexes(indexes,byExtendingSelection:false) }; selecting = false; controls()
    }
    @objc func filterChanged() { renderProfiles() }
    func numberOfRows(in tableView: NSTableView) -> Int { visible.count }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? {
        let p = visible[row],v = object(p["view"]),counts = object(v["counts"]),key = tableColumn?.identifier.rawValue ?? ""
        let text: String
        switch key { case "name": text = string(p["name"]); case "proxy": text = string(p["proxy"]).isEmpty ? "Không proxy" : string(p["proxy"]); case "counts": text = "\(string(counts["today"])) / \(string(counts["total"]))"; default: text = profileStatus(p) }
        let cell = NSTableCellView(),label = NSTextField(labelWithString:text); label.lineBreakMode = .byTruncatingTail; label.font = key == "name" ? .systemFont(ofSize:13,weight:.semibold) : .systemFont(ofSize:12); cell.textField = label; pin(label,in:cell,inset:7); cell.toolTip = text; return cell
    }
    func tableViewSelectionDidChange(_ notification: Notification) { if selecting { return }; let shown = Set(visible.map { string($0["id"]) }); selected.subtract(shown); for index in table.selectedRowIndexes { selected.insert(string(visible[index]["id"])) }; controls(); renderLogs() }
    @objc func selectAllProfiles() { selected.formUnion(visible.map { string($0["id"]) }); renderProfiles(); renderLogs() }
    @objc func clearSelection() { selected.removeAll(); renderProfiles(); renderLogs() }
    func results(_ r: JSONObject) -> String { objects(r["results"]).map { string($0["id"]) + ": " + ($0["ok"] as? Bool == true ? ($0["cancelled"] as? Bool == true ? "đã hủy" : "đã xử lý") : string($0["error"])) }.joined(separator:" · ") }
    @objc func dryRunSelected() { guard let id = selected.first else { return }; perform("Đang chạy thử · chỉ đọc bài và gọi AI…") { api in let r = try await api.request("profile-dry-run",["id":id]); return "Dry-run · model " + string(r["model"]) + " · đã đọc " + string(r["scanned"]) + " bài · chọn " + string(r["selected"]) + " · " + string(r["message"]) + (string(r["preview"]).isEmpty ? "" : "\nBản xem trước: " + string(r["preview"])) } }
    @objc func openSelected() { let ids = Array(selected); openEpoch += 1; let epoch = openEpoch; perform("Đang mở trình duyệt GPM…") { [weak self] api in var lines:[String] = []; for id in ids { guard self?.openEpoch == epoch else { return "Đã hủy các lượt mở còn lại do Dừng." }; let r = try await api.request("profile-open",["profileId":id,"useCurrentProxy":true]); if r["cancelled"] as? Bool == true { return "Đã hủy yêu cầu mở do Dừng." }; lines.append(string(r["profileName"]).isEmpty ? id : string(r["profileName"])) }; return "Đã mở: " + lines.joined(separator:", ") + ". Chưa chạy tự động." } }
    @objc func startSelected() { let ids = Array(selected); perform("Đang chạy profile…") { [weak self] api in self?.results(try await api.request("profiles-start",["ids":ids])) ?? "Đã xử lý" } }
    @objc func startExtensionSelected() { let ids = Array(selected); perform("Đang nạp extension và chạy profile…") { [weak self] api in self?.results(try await api.request("profiles-start-extension",["ids":ids])) ?? "Đã xử lý" } }
    @objc func stopSelected() { openEpoch += 1; let ids = Array(selected); perform("Đang gửi lệnh dừng tới GPM…") { [weak self] api in self?.results(try await api.request("profiles-close",["ids":ids])) ?? "Đã dừng" } }
    func showForm(_ title: String, values: [(String,String)], done: @escaping ([String]) -> Void) {
        editingProfileForm = true
        let alert = NSAlert(); alert.messageText = title; alert.addButton(withTitle:"Lưu"); alert.addButton(withTitle:"Hủy")
        let content = column(); var fields:[NSTextField] = []
        for (label,value) in values {
            content.addArrangedSubview(self.label(label)); let f = NSTextField(string:value); f.isAutomaticTextCompletionEnabled = false; f.usesSingleLineMode = true; fields.append(f)
            if label.hasPrefix("Proxy") {
                f.widthAnchor.constraint(equalToConstant:340).isActive = true
                let note = self.label("Parse chuẩn hóa định dạng · không kiểm tra kết nối")
                let parse = CallbackButton("Parse") {}
                parse.callback = { [weak self, weak parse, weak alert] in
                    guard let api = self?.api else { return }; parse?.isEnabled = false; alert?.buttons.first?.isEnabled = false; note.stringValue = "Đang parse proxy…"
                    Task { @MainActor in
                        defer { parse?.isEnabled = true; alert?.buttons.first?.isEnabled = true }
                        do { let r = try await api.request("proxy-parse",["proxy":f.stringValue]); f.stringValue = string(r["proxy"]); note.stringValue = "Hợp lệ · " + string(r["label"]) }
                        catch { note.stringValue = error.localizedDescription }
                    }
                }
                content.addArrangedSubview(row([f,parse])); content.addArrangedSubview(note)
            } else { f.widthAnchor.constraint(equalToConstant:430).isActive = true; content.addArrangedSubview(f) }
        }
        content.layoutSubtreeIfNeeded(); content.frame = NSRect(x:0,y:0,width:450,height:CGFloat(values.count)*65+40); alert.accessoryView = content
        alert.beginSheetModal(for:view.window!) { response in self.editingProfileForm = false; if response == .alertFirstButtonReturn { done(fields.map { $0.stringValue }) } }
    }
    @objc func createProfile() { showForm("Tạo profile GPM mới",values:[("Tên profile",""),("Proxy · IP:port:user:pass (trống = không dùng)",""),("Chrome · để trống tự chọn","")]) { [weak self] values in self?.perform("Đang tạo profile GPM…") { api in let r = try await api.request("profile-create",["name":values[0],"proxy":values[1],"browserVersion":values[2]]); self?.selected = [string(object(r["profile"])["id"])]; return "Đã tạo profile. Chọn Mở trình duyệt để kiểm tra đăng nhập." } } }
    @objc func editProfile() { guard let id = selected.first, let p = profiles.first(where:{string($0["id"]) == id}) else { return }; showForm("Sửa profile",values:[("Tên",string(p["name"])),("Proxy",string(p["proxy"]))]) { [weak self] values in self?.perform("Đang cập nhật GPM…") { api in _ = try await api.request("profile-edit",["id":id,"name":values[0],"proxy":values[1]]); return "Đã cập nhật tên và proxy." } } }
    @objc func deleteProfile() { guard let id = selected.first else { return }; let alert = NSAlert(); alert.messageText = "Chuyển profile vào thùng rác GPM?"; alert.informativeText = "Profile sẽ được xóa khỏi bảng tool. Lịch sử trên máy vẫn được giữ."; alert.addButton(withTitle:"Xóa"); alert.addButton(withTitle:"Hủy"); alert.beginSheetModal(for:view.window!) { [weak self] result in if result == .alertFirstButtonReturn { self?.perform("Đang xóa profile…") { api in _ = try await api.request("profile-delete",["id":id]); return "Đã chuyển profile vào thùng rác GPM." } } } }
    @objc func pickGpm() { picker = ProfilePicker(owner:self); picker?.show() }
    @objc func importFile() {
        let panel = NSOpenPanel(); panel.allowedContentTypes = [.json,.commaSeparatedText,.plainText]; panel.beginSheetModal(for:view.window!) { [weak self] response in guard response == .OK,let url = panel.url,let self = self else { return }
            do { let bytes = try Data(contentsOf:url); guard bytes.count <= 5*1024*1024,let text = String(data:bytes,encoding:.utf8) else { throw failure("File cần UTF-8, tối đa 5 MB.") }; self.picker = ProfilePicker(owner:self,file:["text":text,"filename":url.lastPathComponent]); self.picker?.show() } catch { self.showMessage(error.localizedDescription,error:true) }
        }
    }
    @objc func exportProfiles() {
        let ids = selected.isEmpty ? profiles.map { string($0["id"]) } : Array(selected); guard !ids.isEmpty else { showMessage("Chưa có profile để xuất.",error:true); return }
        let alert = NSAlert(); alert.messageText = "Xuất \(ids.count) profile"; alert.informativeText = "Gói chuyển máy chứa proxy/cookie/phiên đăng nhập. Mở các profile nguồn trước khi xuất; giữ file riêng tư."; alert.addButton(withTitle:"Kèm phiên Threads"); alert.addButton(withTitle:"Chỉ ID và tên"); alert.addButton(withTitle:"Hủy")
        alert.beginSheetModal(for:view.window!) { [weak self] response in guard let self = self,response != .alertThirdButtonReturn else { return }; self.perform("Đang xuất profile…") { api in
            let payload: JSONObject
            if response == .alertFirstButtonReturn { payload = try await api.request("profiles-transfer-export",["ids":ids]) }
            else { payload = ["format":"hoanxu-profile-list","version":1,"exportedAt":ISO8601DateFormatter().string(from:Date()),"profiles":self.profiles.filter { ids.contains(string($0["id"])) }.map { ["id":string($0["id"]),"name":string($0["name"])] }] }
            let data = try JSONSerialization.data(withJSONObject:payload,options:.prettyPrinted); let panel = NSSavePanel(); panel.nameFieldStringValue = response == .alertFirstButtonReturn ? "hoanxu-transfer.json" : "hoanxu-profiles.json"; panel.allowedContentTypes = [.json]
            if await panel.beginSheetModal(for:self.view.window!) == .OK,let url = panel.url { try data.write(to:url,options:.atomic); try? fm.setAttributes([.posixPermissions:0o600],ofItemAtPath:url.path); return "Đã xuất file profile." }; return "Đã hủy lưu file."
        } }
    }
    @objc func chooseImages() { let p = NSOpenPanel(); p.canChooseDirectories = true; p.canChooseFiles = false; p.beginSheetModal(for:view.window!) { [weak self] r in if r == .OK,let u = p.url { self?.inputs["imagesFolder"]?.stringValue = u.path; self?.settingsEdited() } } }
    @objc func importPrompt() { let p = NSOpenPanel(); p.allowedContentTypes = [.plainText]; p.beginSheetModal(for:view.window!) { [weak self] r in if r == .OK,let u = p.url { do { let data = try Data(contentsOf:u); guard data.count <= 200000,let text = String(data:data,encoding:.utf8),text.count <= 50000 else { throw failure("Prompt cần UTF-8 và tối đa 50.000 ký tự.") }; self?.prompt.string = text; self?.settingsEdited() } catch { self?.showMessage(error.localizedDescription,error:true) } } } }
    @objc func checkImages() { let folder = inputs["imagesFolder"]!.stringValue; perform("Đang kiểm tra folder ảnh…") { api in let r = try await api.request("assets",["folder":folder]); if !string(r["error"]).isEmpty { throw failure(string(r["error"])) }; return "Folder hợp lệ · \(string(r["count"])) ảnh. Lưu cài đặt để áp dụng." } }
    @objc func loadModels() { perform("Đang lấy danh sách model…") { [weak self] api in let r = try await api.request("models",[:]), models = r["models"] as? [String] ?? []; guard let self = self,!models.isEmpty else { return "Không có model." }; let alert = NSAlert(); alert.messageText = "Chọn model AI"; alert.addButton(withTitle:"Chọn"); alert.addButton(withTitle:"Hủy"); let popup = NSPopUpButton(frame:NSRect(x:0,y:0,width:430,height:32)); popup.addItems(withTitles:models); popup.selectItem(withTitle:self.inputs["model"]!.stringValue); alert.accessoryView = popup; if await alert.beginSheetModal(for:self.view.window!) == .alertFirstButtonReturn { self.inputs["model"]!.stringValue = popup.titleOfSelectedItem ?? ""; self.settingsEdited() }; return "Chọn model rồi bấm Lưu cho tất cả profile." } }
    func renderLogs() {
        var lines:[(String,String)] = [], recent:[(String,String)] = []
        for p in profiles {
            let view = object(p["view"]), name = string(p["name"])
            for e in objects(view["logs"]) { let time = string(e["time"]); lines.append((time,name + " → " + time + " · " + string(e["message"]))) }
            for r in objects(view["recent"]) { let time = string(r["created_at"]); recent.append((time,name + " → " + time + " · " + string(r["state"]) + " · " + string(r["post_url"]))) }
        }
        let value = lines.sorted { $0.0 > $1.0 }.prefix(300).map { $0.1 }.joined(separator:"\n")
        let historyValue = recent.sorted { $0.0 > $1.0 }.prefix(300).map { $0.1 }.joined(separator:"\n")
        updateLogText(logs,value.isEmpty ? "Chưa có nhật ký." : value)
        updateLogText(history,historyValue.isEmpty ? "Chưa có lịch sử gửi bình luận." : historyValue)
    }
    @objc func loadHistory() { Task { @MainActor in await refresh() } }
    @objc func openData() { if let delegate = NSApp.delegate as? AppDelegate { NSWorkspace.shared.open(delegate.data) } }
    func loadUpdate() async { guard let api = api else { return }; do { updater = try await api.request("update-status"); renderUpdate(); if !string(updater["repository"]).isEmpty { await checkForUpdate() } } catch { updateText.stringValue = error.localizedDescription; versionText.stringValue = "Chưa đọc được phiên bản" } }
    func renderUpdate() {
        let current = string(updater["currentVersion"]), latest = string(updater["latestVersion"]), available = updater["available"] as? Bool == true, error = string(updater["checkError"])
        versionText.stringValue = "Phiên bản " + current + (updateChecking ? " · đang kiểm tra…" : !error.isEmpty ? " · chưa kiểm tra được bản mới" : "")
        updateBanner.isHidden = !available; updateWarning.stringValue = "Bạn chưa dùng phiên bản mới nhất: " + current + " → " + latest + ". Dừng profile và lưu cài đặt trước khi cập nhật."
        updateText.stringValue = available ? updateWarning.stringValue : !error.isEmpty ? "Chưa xác định được bản mới nhất: " + error : string(updater["repository"]).isEmpty ? "Cập nhật từ xa đang tắt · tải bản mới thủ công từ GitHub Releases." : string(updater["checkedAt"]).isEmpty ? "Chưa kiểm tra phiên bản mới." : "Bạn đang dùng bản mới nhất · " + current
        if available && !error.isEmpty { updateText.stringValue += "\nLần kiểm tra gần nhất lỗi: " + error }
        controls()
    }
    func checkForUpdate() async {
        guard let api = api, !updateChecking, !string(updater["repository"]).isEmpty else { return }; updateChecking = true; lastUpdateCheck = Date(); renderUpdate()
        do { updater = try await api.request("update-check",[:]) } catch { updater["checkError"] = error.localizedDescription }
        updateChecking = false; renderUpdate()
    }
    @objc func checkUpdate() { Task { @MainActor in await checkForUpdate() } }
    @objc func installUpdate() { if dirty { showMessage("Lưu cài đặt đang sửa trước khi cập nhật.",error:true); return }; perform("Đang tải và xác minh bản cập nhật…") { api in _ = try await api.request("update-install",[:]); return "Đang cài và mở lại app…" } }
}

final class ProfilePicker: NSObject, NSTableViewDataSource, NSTableViewDelegate, NSWindowDelegate, NSSearchFieldDelegate {
    weak var owner: DesktopController?; var window: NSWindow!,rows:[JSONObject] = [],preview:JSONObject = [:],file:JSONObject?,chosen = Set<String>(),loading = false
    let table = ToggleTable(),query = NSSearchField(),groups = NSPopUpButton(),browserVersion = NSTextField(),note = NSTextField(wrappingLabelWithString:""),add = NSButton(),progress = NSProgressIndicator()
    var groupIDs = [""]
    init(owner: DesktopController,file: JSONObject? = nil) { self.owner = owner; self.file = file }
    func show() {
        guard let owner = owner else { return }; window = NSWindow(contentRect:NSRect(x:0,y:0,width:850,height:590),styleMask:[.titled,.closable,.resizable],backing:.buffered,defer:false); window.title = file == nil ? "Chọn profile có sẵn trong GPM" : "Nhập / khôi phục profile"; window.isReleasedWhenClosed = false; window.delegate = self
        let stack = owner.column(); owner.pin(stack,in:window.contentView!,inset:18); query.delegate = self; browserVersion.delegate = self; query.placeholderString = "Tên, một phần tên hoặc ID"; query.target = self; query.action = #selector(load); groups.addItem(withTitle:"Tất cả nhóm"); groups.target = self; groups.action = #selector(load)
        let find = NSButton(title:"Tìm kiếm",target:self,action:#selector(load)); let controls = owner.row([query,groups,find]); query.widthAnchor.constraint(greaterThanOrEqualToConstant:350).isActive = true; if file == nil { owner.addWide(controls,to:stack) }
        else { browserVersion.placeholderString = "Chrome trên máy đích · tùy chọn, ví dụ 152.0.0.0"; owner.addWide(browserVersion,to:stack); owner.addWide(owner.row([find,owner.label("Xác nhận sẽ tạo/mở GPM nếu file kèm phiên Threads.")]),to:stack) }
        table.delegate = self; table.dataSource = self; table.allowsMultipleSelection = true; table.rowHeight = 38; table.usesAlternatingRowBackgroundColors = true
        for (key,title,width) in [("name","Tên profile",230.0),("id","ID",230.0),("message","Kết quả đối chiếu",330.0)] { let c = NSTableColumn(identifier:NSUserInterfaceItemIdentifier(key)); c.title = title; c.width = width; table.addTableColumn(c) }; owner.addWide(owner.scroll(table),to:stack)
        owner.addWide(note,to:stack); add.title = "Thêm profile đã chọn"; add.target = self; add.action = #selector(commit); add.bezelStyle = .rounded; add.isEnabled = false; let all = NSButton(title:"Chọn tất cả hợp lệ",target:self,action:#selector(selectAll)),cancel = NSButton(title:"Hủy",target:self,action:#selector(cancel)); progress.style = .spinning; progress.isDisplayedWhenStopped = false; owner.addWide(owner.row([progress,cancel,all,add]),to:stack)
        owner.view.window!.beginSheet(window); load()
    }
    @objc func load() {
        guard let api = owner?.api,!loading else { return }; loading = true; query.isEnabled = false; groups.isEnabled = false; browserVersion.isEnabled = false; chosen.removeAll(); add.isEnabled = false; progress.startAnimation(nil); note.stringValue = "Đang đối chiếu profile GPM…"
        Task { @MainActor in do {
            var body:JSONObject = file ?? ["fromGpm":true,"query":query.stringValue,"groupId":groupIDs[groups.indexOfSelectedItem]]; if file != nil { body["browserVersion"] = browserVersion.stringValue }
            preview = try await api.request("profiles-import-preview",body); rows = objects(preview["rows"]); let saved = file == nil ? groupIDs[groups.indexOfSelectedItem] : ""
            if file == nil { let values = objects(preview["groups"]); groups.removeAllItems(); groups.addItems(withTitles:["Tất cả nhóm"] + values.map { string($0["name"]) }); groupIDs = [""] + values.map { string($0["id"]) }; if let i = groupIDs.firstIndex(of:saved) { groups.selectItem(at:i) } }
            table.reloadData(); note.stringValue = "\(rows.count) dòng · bấm dòng để chọn. " + (preview["limited"] as? Bool == true ? "Giới hạn 500 kết quả, dùng tên/nhóm để thu hẹp." : "") + string(preview["groupsWarning"])
        } catch { note.stringValue = error.localizedDescription }; loading = false; query.isEnabled = true; groups.isEnabled = true; browserVersion.isEnabled = true; progress.stopAnimation(nil); add.isEnabled = !chosen.isEmpty }
    }
    func controlTextDidChange(_ notification: Notification) { chosen.removeAll(); rows = []; preview = [:]; table.reloadData(); add.isEnabled = false; note.stringValue = "Đã đổi bộ lọc · bấm Tìm kiếm để đối chiếu lại." }
    func numberOfRows(in tableView: NSTableView) -> Int { rows.count }
    @objc func cancel() { owner?.view.window?.endSheet(window); window.close() }
    func windowShouldClose(_ sender: NSWindow) -> Bool { owner?.view.window?.endSheet(sender); return true }
    func tableView(_ tableView: NSTableView, shouldSelectRow row: Int) -> Bool { string(rows[row]["status"]) == "ready" && !loading }
    func tableView(_ tableView: NSTableView, viewFor tableColumn: NSTableColumn?, row: Int) -> NSView? { let c = NSTableCellView(),l = NSTextField(labelWithString:string(rows[row][tableColumn?.identifier.rawValue ?? "name"])); l.textColor = string(rows[row]["status"]) == "ready" ? .labelColor : .secondaryLabelColor; l.lineBreakMode = .byTruncatingTail; c.textField = l; owner?.pin(l,in:c,inset:6); return c }
    func tableViewSelectionDidChange(_ notification: Notification) { chosen = Set(table.selectedRowIndexes.filter { rows.indices.contains($0) && string(rows[$0]["status"]) == "ready" }.map { string(rows[$0]["id"]) }); add.isEnabled = !chosen.isEmpty && !loading }
    @objc func selectAll() { table.selectRowIndexes(IndexSet(rows.indices.filter { string(rows[$0]["status"]) == "ready" }),byExtendingSelection:false) }
    @objc func commit() { guard let api = owner?.api,!chosen.isEmpty,!loading else { return }; let ids = Array(chosen),token = string(preview["token"]); loading = true; query.isEnabled = false; groups.isEnabled = false; browserVersion.isEnabled = false; add.isEnabled = false; progress.startAnimation(nil)
        Task { @MainActor in do { var results:[JSONObject] = []; for offset in stride(from:0,to:ids.count,by:500) { note.stringValue = "Đang nhập \(min(offset+500,ids.count)) / \(ids.count)…"; let r = try await api.request("profiles-import",["token":token,"ids":Array(ids[offset..<min(offset+500,ids.count)])]); results += objects(r["results"]) }
            let added = results.filter { string($0["status"]) == "imported" }; owner?.selected = Set(added.map { string($0["id"]) }); await owner?.refresh(); let errors = results.filter { string($0["status"]) != "imported" }
            note.stringValue = "Đã thêm \(added.count) profile. " + errors.map { string($0["message"]) }.joined(separator:" · "); owner?.showMessage(note.stringValue + " Kiểm tra đăng nhập trước khi chạy tự động."); if errors.isEmpty { owner?.view.window?.endSheet(window); window.close() }
        } catch { note.stringValue = error.localizedDescription }; loading = false; query.isEnabled = true; groups.isEnabled = true; browserVersion.isEnabled = true; progress.stopAnimation(nil); add.isEnabled = !chosen.isEmpty }
    }
}
