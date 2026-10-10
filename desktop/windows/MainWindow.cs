using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Globalization;
using System.Text;
using System.Text.Json;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;
using System.Windows.Input;
using System.Windows.Media;
using System.Windows.Threading;
using Microsoft.Win32;

namespace HoanXu;

sealed class ProfileRow : INotifyPropertyChanged
{
    public JsonObject Data = new();
    bool selected;
    public string Id => J.S(Data["id"]);
    public string Name => J.S(Data["name"]);
    public string Proxy => J.S(Data["proxy"]) is { Length: > 0 } value ? value : "Không proxy";
    public JsonObject State => J.O(J.O(Data["view"])["state"]);
    public string Category
    {
        get
        {
            var status = J.S(State["status"]);
            if (status == "attention" || J.S(J.O(Data["gpm"])["status"]) is "missing" or "unavailable" || J.S(Data["error"]).Length > 0 || J.S(J.O(Data["view"])["error"]).Length > 0) return "Cần kiểm tra";
            if (status is "running" or "stopping") return J.S(J.O(State["activity"])["phase"]) is "resting" or "waiting" or "session-rest" ? "Đang nghỉ" : "Đang chạy";
            return "Đã dừng";
        }
    }
    public string Status {
        get { var g = J.O(Data["gpm"]); var remote = J.B(g["fresh"]) && J.S(g["status"]) == "present" ? "GPM đã đồng bộ" : J.S(g["error"]) is { Length: > 0 } e ? e : "GPM chưa đồng bộ"; return string.Join(" · ", new[] { Category, remote, J.B(J.O(Data["view"])["connected"]) ? "CDP đã kết nối" : "CDP chưa kết nối", J.S(Data["error"]) is { Length: > 0 } error ? error : J.S(J.O(State["activity"])["message"]) }.Where(v => v.Length > 0)); }
    }
    public string Counts => J.S(J.O(J.O(Data["view"])["counts"])["today"]) + " / " + J.S(J.O(J.O(Data["view"])["counts"])["total"]);
    public bool Selected { get => selected; set { if (selected == value) return; selected = value; Changed(nameof(Selected)); } }
    public event PropertyChangedEventHandler? PropertyChanged;
    public void Changed(string? name = null) => PropertyChanged?.Invoke(this, new(name));
}

sealed class MainWindow : Window
{
    readonly Backend backend;
    ToolApi? api;
    JsonObject snapshot = new(), update = new();
    readonly Dictionary<string, ProfileRow> allRows = new();
    readonly ObservableCollection<ProfileRow> rows = new();
    readonly DataGrid profiles = new();
    readonly TextBox search = new(), prompt = new(), logs = new(), history = new();
    readonly ComboBox category = new(), model = new() { IsEditable = true };
    readonly PasswordBox key = new();
    readonly TextBlock message = new(), selection = new(), saved = new(), updateText = new();
    readonly TextBlock versionText = new(), updateWarning = new();
    readonly Border updateBanner = new() { Background = Brushes.LemonChiffon, Padding = new(12), Margin = new(0, 0, 0, 10), Visibility = Visibility.Collapsed };
    bool updateChecking; DateTime lastUpdateCheck = DateTime.MinValue;
    readonly ProgressBar progress = new() { IsIndeterminate = true, Height = 3, Visibility = Visibility.Collapsed };
    readonly Dictionary<string, TextBox> fields = new();
    readonly Dictionary<string, CheckBox> checks = new();
    readonly Dictionary<string, Button> buttons = new();
    readonly DispatcherTimer poll = new() { Interval = TimeSpan.FromSeconds(2) };
    bool refreshing, loaded, dirty, filling, closing, closed;
    int busy, openEpoch;
    readonly bool smoke;
    public MainWindow(Backend backend, bool smoke = false)
    {
        this.backend = backend; this.smoke = smoke;
        Title = "Hoàn Xu · GPM Tool"; Width = 1180; Height = 860; MinWidth = 1000; MinHeight = 720;
        WindowStartupLocation = WindowStartupLocation.CenterScreen; FontFamily = new("Segoe UI"); FontSize = 13; Background = Brushes.WhiteSmoke;
        Resources[typeof(Button)] = new Style(typeof(Button)) { Setters = { new Setter(Control.PaddingProperty, new Thickness(12, 7, 12, 7)), new Setter(FrameworkElement.MarginProperty, new Thickness(0, 0, 8, 0)) } };
        var root = new DockPanel { Margin = new(24) }; Content = root;
        var header = new StackPanel { Margin = new(0, 0, 0, 18) }; header.Children.Add(new TextBlock { Text = "Hoàn Xu · Threads Workspace", FontSize = 26, FontWeight = FontWeights.SemiBold, Foreground = new SolidColorBrush(Color.FromRgb(20, 70, 54)) }); header.Children.Add(Note("Thêm profile → mở để kiểm tra đăng nhập → lưu cài đặt → chạy tự động")); header.Children.Add(Row(versionText, Action("Kiểm tra cập nhật", "check-update-top", () => _ = CheckForUpdate())));
        updateWarning.TextWrapping = TextWrapping.Wrap; updateWarning.Foreground = Brushes.SaddleBrown;
        var banner = new DockPanel(); var installTop = Action("Cập nhật & mở lại", "install-update-top", InstallUpdate); DockPanel.SetDock(installTop, Dock.Right); banner.Children.Add(installTop); banner.Children.Add(updateWarning); updateBanner.Child = banner; header.Children.Add(updateBanner);
        DockPanel.SetDock(header, Dock.Top); root.Children.Add(header);
        var footer = new StackPanel { Margin = new(0, 14, 0, 0) }; footer.Children.Add(progress); message.Text = "Đang khởi động ứng dụng…"; message.TextWrapping = TextWrapping.Wrap; message.Margin = new(0, 8, 0, 0); footer.Children.Add(message); DockPanel.SetDock(footer, Dock.Bottom); root.Children.Add(footer);
        var tabs = new TabControl(); root.Children.Add(tabs); tabs.Items.Add(new TabItem { Header = "Profile", Content = ProfilesPage() }); tabs.Items.Add(new TabItem { Header = "Cài đặt chung", Content = SettingsPage() }); tabs.Items.Add(new TabItem { Header = "Nhật ký & lịch sử", Content = LogsPage() });
        poll.Tick += async (_, _) => { await Refresh(); if (DateTime.UtcNow - lastUpdateCheck >= TimeSpan.FromMinutes(1)) await CheckForUpdate(); };
        backend.Exited += code => Dispatcher.BeginInvoke(new Action(() =>
        {
            if (code == 42) { try { backend.LaunchUpdater(); closing = true; Close(); } catch (Exception e) { Message(e.Message, true); } }
            else if (!closing) Message("Backend đã thoát. Xem app.log trong thư mục dữ liệu.", true);
        }));
        Loaded += async (_, _) => { try { await backend.Start(); api = backend.Api; await Refresh(); await LoadUpdate(!smoke); poll.Start(); if (smoke) await Smoke(); } catch (Exception e) { Message(e.Message, true); if (smoke) { Environment.ExitCode = 1; closing = true; Close(); } } };
        Closing += async (_, e) =>
        {
            if (closed || (closing && backend.Process?.HasExited != false)) return;
            e.Cancel = true;
            if (!closing && allRows.Values.Any(p => J.S(p.State["status"]) is "running" or "stopping") && MessageBox.Show(this, "Có profile đang chạy. Thoát app sẽ ngừng bộ chạy; profile GPM có thể vẫn mở. Nên bấm Dừng & đóng trước nếu muốn kết thúc.\n\nVẫn thoát app?", "Thoát Hoàn Xu", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
            if (closing) return; closing = true; poll.Stop();
            try { await backend.Close(); closed = true; Close(); } catch (Exception error) { closing = false; Message("Chưa thoát được: " + error.Message, true); }
        };
        Controls(); progress.Visibility = Visibility.Visible;
    }
    public static TextBlock Note(string text) => new() { Text = text, Foreground = Brushes.DimGray, TextWrapping = TextWrapping.Wrap, Margin = new(0, 6, 0, 8) };
    public static StackPanel Row(params UIElement[] items) { var p = new StackPanel { Orientation = Orientation.Horizontal, Margin = new(0, 0, 0, 10) }; foreach (var item in items) p.Children.Add(item); return p; }
    Button Action(string title, string id, Action click)
    {
        var button = new Button { Content = title, Name = id.Replace('-', '_') }; button.Click += (_, _) => click(); buttons[id] = button; return button;
    }
    void Message(string text, bool error = false) { message.Text = text; message.Foreground = error ? Brushes.Firebrick : Brushes.DimGray; }
    async void Perform(string title, Func<ToolApi, Task<string>> action)
    {
        if (api == null) return; busy++; Controls(); Message(title);
        try { Message(await action(api)); await Refresh(); } catch (Exception e) { Message(e.Message, true); } finally { busy--; Controls(); }
    }
    IEnumerable<ProfileRow> Selected => allRows.Values.Where(p => p.Selected);
    string[] Ids => Selected.Select(p => p.Id).ToArray();
    void Controls()
    {
        progress.Visibility = busy > 0 ? Visibility.Visible : Visibility.Collapsed;
        var ready = api != null && loaded;
        foreach (var (id, b) in buttons) b.IsEnabled = ready && busy == 0;
        foreach (var id in new[] { "open-selected", "start-selected", "start-extension" }) buttons[id].IsEnabled &= Selected.Any();
        buttons["stop-selected"].IsEnabled = ready && Selected.Any();
        foreach (var id in new[] { "edit-profile", "delete-profile", "dry-run-selected" }) buttons[id].IsEnabled &= Selected.Count() == 1;
        foreach (var id in new[] { "install-update", "install-update-top" }) buttons[id].IsEnabled = api != null && busy == 0 && !updateChecking && J.B(update["available"]) && J.B(update["installSupported"]);
        foreach (var id in new[] { "check-update", "check-update-top" }) buttons[id].IsEnabled = api != null && busy == 0 && !updateChecking && J.S(update["repository"]).Length > 0;
        selection.Text = Selected.Any() ? $"Đã chọn {Selected.Count()} profile" : "Chưa chọn profile";
        foreach (var field in fields.Values) field.IsEnabled = api != null && loaded && busy == 0;
        foreach (var check in checks.Values) check.IsEnabled = api != null && loaded && busy == 0;
        model.IsEnabled = key.IsEnabled = api != null && loaded && busy == 0; prompt.IsReadOnly = !loaded || busy > 0;
    }
    UIElement ProfilesPage()
    {
        var page = new DockPanel { Margin = new(14) };
        var top = new StackPanel(); top.Children.Add(Row(Action("Từ GPM…", "pick-gpm", () => new ProfilePicker(this, api!).ShowDialog()), Action("Tạo mới…", "create-profile", CreateProfile), Action("Nhập file…", "import-file", ImportFile), Action("Xuất / chuyển máy…", "export-profiles", ExportProfiles)));
        search.Width = 390; search.Margin = new(0, 0, 12, 0); search.ToolTip = "Tìm tên hoặc ID"; search.TextChanged += (_, _) => Filter();
        foreach (var v in new[] { "Tất cả", "Đang chạy", "Đang nghỉ", "Cần kiểm tra", "Đã dừng" }) category.Items.Add(v); category.SelectedIndex = 0; category.SelectionChanged += (_, _) => Filter(); category.Margin = new(0, 0, 12, 0); category.Width = 145;
        top.Children.Add(Row(search, category, Action("Chọn tất cả", "select-all", () => { foreach (var p in rows) p.Selected = true; Controls(); RenderLogs(); }), Action("Bỏ chọn", "clear-selection", () => { foreach (var p in allRows.Values) p.Selected = false; Controls(); RenderLogs(); })));
        DockPanel.SetDock(top, Dock.Top); page.Children.Add(top);
        var bottom = new StackPanel { Margin = new(0, 12, 0, 0) }; selection.Width = 170; selection.VerticalAlignment = VerticalAlignment.Center;
        bottom.Children.Add(Row(selection, Action("Mở trình duyệt", "open-selected", OpenSelected), Action("Chạy thử · không đăng", "dry-run-selected", DryRunSelected), Action("Dừng & đóng", "stop-selected", () => { openEpoch++; Batch("close"); })));
        bottom.Children.Add(Row(Action("Chạy tự động", "start-selected", () => Batch("start")), Action("Chạy bằng extension", "start-extension", () => Batch("start-extension")), Note("Extension tự được nạp vào profile · dùng cùng cài đặt và lịch sử")));
        bottom.Children.Add(Row(Action("Sửa tên / proxy…", "edit-profile", EditProfile), Action("Xóa khỏi GPM…", "delete-profile", DeleteProfile), Note("Bấm dòng để chọn/bỏ chọn · Mở chỉ mở GPM, chưa chạy tự động")));
        DockPanel.SetDock(bottom, Dock.Bottom); page.Children.Add(bottom);
        profiles.Name = "ProfilesTable"; profiles.ItemsSource = rows; profiles.IsReadOnly = false; profiles.CanUserAddRows = false; profiles.CanUserDeleteRows = false; profiles.AutoGenerateColumns = false; profiles.HeadersVisibility = DataGridHeadersVisibility.Column; profiles.RowHeight = 46; profiles.GridLinesVisibility = DataGridGridLinesVisibility.Horizontal; profiles.AlternatingRowBackground = Brushes.White; profiles.Background = Brushes.WhiteSmoke;
        profiles.Columns.Add(new DataGridCheckBoxColumn { Header = "✓", Binding = new Binding("Selected") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged }, Width = 40 });
        foreach (var (path, title, width) in new[] { ("Name", "Profile", 215d), ("Proxy", "Proxy", 200d), ("Status", "Trạng thái / thao tác", 360d), ("Counts", "Hôm nay / tổng", 120d) }) profiles.Columns.Add(new DataGridTextColumn { Header = title, Binding = new Binding(path), Width = width, IsReadOnly = true });
        var rowStyle = new Style(typeof(DataGridRow)); var selected = new DataTrigger { Binding = new Binding("Selected"), Value = true }; selected.Setters.Add(new Setter(Control.BackgroundProperty, new SolidColorBrush(Color.FromRgb(213, 239, 229)))); rowStyle.Triggers.Add(selected); profiles.RowStyle = rowStyle;
        profiles.PreviewMouseLeftButtonDown += (_, e) => { var source = e.OriginalSource as DependencyObject; if (Find<CheckBox>(source) != null || Find<Button>(source) != null || Find<ScrollBar>(source) != null) return; if (Find<DataGridRow>(source)?.Item is ProfileRow p) { p.Selected = !p.Selected; e.Handled = true; } };
        page.Children.Add(profiles); return page;
    }
    internal static T? Find<T>(DependencyObject? source) where T : DependencyObject { while (source != null) { if (source is T item) return item; source = source is Visual ? VisualTreeHelper.GetParent(source) : LogicalTreeHelper.GetParent(source); } return null; }
    UIElement Field(string title, string name, double width = 300)
    {
        var panel = new StackPanel { Width = width, Margin = new(0, 0, 15, 10) }; panel.Children.Add(Note(title)); var box = new TextBox { MinHeight = 28, Padding = new(6), Name = name }; fields[name] = box; box.TextChanged += (_, _) => Edited(); panel.Children.Add(box); return panel;
    }
    UIElement SettingsPage()
    {
        var page = new StackPanel { Margin = new(18) };
        page.Children.Add(Row(Note("Dùng chung cho tất cả profile + profile thêm mới"), Action("Lưu cho tất cả profile", "save-settings", SaveSettings))); saved.TextWrapping = TextWrapping.Wrap; page.Children.Add(saved);
        page.Children.Add(Field("GPM Local API · đúng địa chỉ trong cài đặt GPM", "gpmApi", 850));
        page.Children.Add(Row(Action("Kiểm tra / tìm GPM", "check-gpm", CheckGpm), Note("Mở GPM trước · tìm cổng 9495 hoặc 19995")));
        var modelPanel = new StackPanel { Width = 320, Margin = new(0, 0, 15, 10) }; modelPanel.Children.Add(Note("Model AI")); model.MinHeight = 30; modelPanel.Children.Add(model); model.AddHandler(TextBoxBase.TextChangedEvent, new TextChangedEventHandler((_, _) => Edited()));
        var keyPanel = new StackPanel { Width = 320, Margin = new(0, 0, 15, 10) }; keyPanel.Children.Add(Note("API key · để trống giữ key đã lưu")); key.MinHeight = 30; key.PasswordChanged += (_, _) => Edited(); keyPanel.Children.Add(key);
        page.Children.Add(Row(modelPanel, keyPanel, Action("Tải model", "load-models", () => Perform("Đang lấy danh sách model…", async api => { var r = await api.Request("models", new()); var current = model.Text; model.Items.Clear(); foreach (var node in r["models"] as JsonArray ?? new()) model.Items.Add(J.S(node)); model.Text = current; return "Chọn model rồi bấm Lưu cho tất cả profile."; }))));
        page.Children.Add(Field("Chủ đề muốn tìm · phân cách bằng dấu phẩy", "keywords", 850));
        page.Children.Add(Row(Field("Nghỉ trung bình · giây (±20%)", "restAverageSeconds", 255), Field("Gõ mỗi ký tự · ms", "typingDelayMs", 255), Field("Chờ giữa thao tác · giây", "stepSeconds", 255)));
        page.Children.Add(Row(Field("Chờ tìm bài mới · giây", "searchDelaySeconds", 255), Field("Folder ảnh · trống dùng ảnh đi kèm", "imagesFolder", 430), Action("Chọn folder…", "choose-images", () => { var d = new OpenFolderDialog(); if (d.ShowDialog(this) == true) fields["imagesFolder"].Text = d.FolderName; })));
        foreach (var (name, text) in new[] { ("followBeforeComment", "Theo dõi trước khi bình luận · 60% bài, chờ 210–270 giây sau follow mới"), ("tagHoanxu", "Tag @hoanxu.app · sau mỗi 4 bài ảnh, thêm 1 bài chữ có tag"), ("idleScroll", "Cuộn nhẹ khi nghỉ"), ("idleEngagement", "Thả tim khi chờ · ngẫu nhiên 2–5 bài") }) { var check = new CheckBox { Content = text, Margin = new(0, 0, 0, 12) }; check.Checked += (_, _) => Edited(); check.Unchecked += (_, _) => Edited(); checks[name] = check; page.Children.Add(check); }
        page.Children.Add(Note("Hướng dẫn cho AI (prompt)")); prompt.Name = "Prompt"; prompt.AcceptsReturn = true; prompt.TextWrapping = TextWrapping.Wrap; prompt.VerticalScrollBarVisibility = ScrollBarVisibility.Auto; prompt.Height = 230; prompt.TextChanged += (_, _) => Edited(); page.Children.Add(prompt);
        page.Children.Add(Row(Action("Nhập prompt .txt…", "import-prompt", ImportPrompt), Action("Kiểm tra ảnh", "check-images", () => Perform("Đang kiểm tra folder ảnh…", async api => { var r = await api.Request("assets", new() { ["folder"] = fields["imagesFolder"].Text }); if (J.S(r["error"]).Length > 0) throw new Exception(J.S(r["error"])); return $"Folder hợp lệ · {J.S(r["count"])} ảnh. Lưu để áp dụng."; }))));
        page.Children.Add(Note("Bấm Lưu để áp dụng AI, chủ đề và nhịp chạy từ bước tiếp theo. Lượt AI/comment đang thực hiện sẽ hoàn tất."));
        page.Children.Add(new Separator { Margin = new(0, 12, 0, 12) }); page.Children.Add(Row(Action("Kiểm tra cập nhật", "check-update", () => _ = CheckForUpdate()), Action("Cài bản mới & mở lại", "install-update", InstallUpdate)));
        updateText.TextWrapping = TextWrapping.Wrap; page.Children.Add(updateText); return new ScrollViewer { Content = page, VerticalScrollBarVisibility = ScrollBarVisibility.Auto };
    }
    UIElement LogsPage()
    {
        var page = new DockPanel { Margin = new(16) }; var note = Note("Nhật ký tất cả profile · Lịch sử gần đây tự cập nhật"); DockPanel.SetDock(note, Dock.Top); page.Children.Add(note);
        var bottom = new StackPanel(); bottom.Children.Add(Row(Action("Làm mới nhật ký & lịch sử", "load-history", async () => await Refresh()), Action("Mở thư mục dữ liệu", "open-data", () => System.Diagnostics.Process.Start(new System.Diagnostics.ProcessStartInfo(backend.DataPath) { UseShellExecute = true }))));
        history.Height = 140; bottom.Children.Add(history); DockPanel.SetDock(bottom, Dock.Bottom); page.Children.Add(bottom);
        foreach (var text in new[] { logs, history }) { text.IsReadOnly = true; text.AcceptsReturn = true; text.VerticalScrollBarVisibility = ScrollBarVisibility.Auto; text.HorizontalScrollBarVisibility = ScrollBarVisibility.Auto; text.FontFamily = new("Consolas"); text.FontSize = 12; }
        page.Children.Add(logs); return page;
    }
    public async Task Refresh()
    {
        if (api == null || refreshing || closing || EditingProfileForm) return; refreshing = true;
        try
        {
            snapshot = await api.Request("state"); if (EditingProfileForm) return; if (!loaded) { FillSettings(J.O(snapshot["settings"])); loaded = true; Message("Sẵn sàng · dữ liệu được lưu trên máy"); }
            var ids = new HashSet<string>(); foreach (var data in J.Rows(snapshot["profiles"])) { var id = J.S(data["id"]); ids.Add(id); if (!allRows.TryGetValue(id, out var row)) { row = new(); row.PropertyChanged += (_, e) => { if (e.PropertyName == "Selected") { Controls(); RenderLogs(); } }; allRows[id] = row; } row.Data = data; row.Changed(); }
            foreach (var id in allRows.Keys.Except(ids).ToArray()) allRows.Remove(id);
            Filter(); RenderLogs(); Controls();
            var download = J.O(snapshot["updateDownload"]); var phase = J.S(download["phase"]);
            if (phase is "downloading" or "verifying" or "ready") { message.Text = updateText.Text = updateWarning.Text = J.S(download["message"]); progress.Visibility = Visibility.Visible; progress.IsIndeterminate = phase != "downloading"; if (double.TryParse(J.S(download["percent"]), out var percent)) progress.Value = percent; }
            else progress.IsIndeterminate = true;
        }
        catch (Exception e) { if (busy == 0) Message("Mất kết nối · đang thử lại: " + e.Message, true); }
        finally { refreshing = false; }
    }
    void Filter()
    {
        var query = search.Text.Trim(); var choice = category.SelectedItem?.ToString() ?? "Tất cả";
        var values = allRows.Values.Where(p => (query.Length == 0 || (p.Name + " " + p.Id).Contains(query, StringComparison.OrdinalIgnoreCase)) && (choice == "Tất cả" || p.Category == choice)).ToArray();
        if (!rows.SequenceEqual(values)) { rows.Clear(); foreach (var p in values) rows.Add(p); }
    }
    void Edited() { if (filling || !loaded) return; dirty = true; saved.Text = "Có thay đổi chưa lưu"; saved.Foreground = Brushes.DarkOrange; }
    void FillSettings(JsonObject settings)
    {
        filling = true; var config = J.O(settings["runConfig"]);
        foreach (var (name, field) in fields) field.Text = J.S(name is "keywords" or "restAverageSeconds" or "typingDelayMs" or "stepSeconds" or "searchDelaySeconds" ? config[name] : settings[name]);
        if (config["restAverageSeconds"] == null) fields["restAverageSeconds"].Text = ((double.Parse(J.S(config["minRestSeconds"] ?? JsonValue.Create(120)), CultureInfo.InvariantCulture) + double.Parse(J.S(config["maxRestSeconds"] ?? JsonValue.Create(180)), CultureInfo.InvariantCulture)) / 2).ToString(CultureInfo.InvariantCulture);
        model.Text = J.S(settings["model"]); key.Password = ""; prompt.Text = J.S(settings["prompt"]); foreach (var (name, check) in checks) check.IsChecked = config[name] == null ? name == "idleEngagement" : J.B(config[name]);
        filling = false; dirty = false; saved.Text = "Đã lưu · áp dụng cho tất cả profile"; saved.Foreground = Brushes.DimGray;
    }
    JsonObject SettingsBody()
    {
        var value = J.O(snapshot["settings"]).DeepClone().AsObject(); var config = J.O(value["runConfig"]).DeepClone().AsObject();
        foreach (var (name, field) in fields)
        {
            if (name is "restAverageSeconds" or "typingDelayMs" or "stepSeconds" or "searchDelaySeconds") { if (!double.TryParse(field.Text, NumberStyles.Float, CultureInfo.InvariantCulture, out var n) || !double.IsFinite(n) || n < 0) throw new Exception(name + ": nhập số không âm."); config[name] = n; }
            else if (name == "keywords") config[name] = field.Text; else value[name] = field.Text.Trim();
        }
        foreach (var (name, check) in checks) config[name] = check.IsChecked == true;
        value["model"] = model.Text.Trim(); value["apiKey"] = key.Password; value["prompt"] = prompt.Text; value["scope"] = "all"; value["runConfig"] = config; return value;
    }
    async Task<string> Save(ToolApi api)
    {
        var r = await api.Request("settings", SettingsBody()); snapshot["settings"] = r["settings"]?.DeepClone(); FillSettings(J.O(r["settings"]));
        var failed = J.Rows(r["results"]).Where(p => !J.B(p["ok"])).ToArray();
        if (failed.Length > 0) throw new Exception("Đã lưu cấu hình chung, còn profile chưa áp dụng: " + string.Join(" · ", failed.Select(p => J.S(p["name"]) + ": " + J.S(p["error"]))));
        return "Đã lưu cho tất cả profile · model " + J.S(J.O(r["settings"])["model"]) + " · dùng từ bước tiếp theo.";
    }
    void CheckGpm() { var address = fields["gpmApi"].Text.Trim(); Perform("Đang kiểm tra GPM Local API…", async api => { var r = await api.Request("gpm-check", new() { ["gpmApi"] = address }); if (J.B(r["discovered"])) fields["gpmApi"].Text = J.S(r["gpmApi"]); return J.S(r["message"]); }); }
    void SaveSettings() => Perform("Đang lưu cho tất cả profile…", Save);
    string Results(JsonObject r) => string.Join(" · ", J.Rows(r["results"]).Select(p => (allRows.TryGetValue(J.S(p["id"]), out var row) ? row.Name : J.S(p["id"])) + ": " + (J.B(p["ok"]) ? (J.B(p["cancelled"]) ? "đã hủy" : "đã xử lý") : J.S(p["error"]))));
    void Batch(string action) { var ids = Ids; Perform(action == "start-extension" ? "Đang nạp extension và chạy profile…" : action == "start" ? "Đang chạy profile…" : "Đang gửi lệnh dừng tới GPM…", async api => Results(await api.Request("profiles-" + action, new() { ["ids"] = J.Strings(ids) }))); }
    void DryRunSelected() { var id = Ids.Single(); Perform("Đang chạy thử · chỉ đọc bài và gọi AI…", async api => { var r = await api.Request("profile-dry-run", new() { ["id"] = id }); return "Dry-run · model " + J.S(r["model"]) + " · đã đọc " + J.S(r["scanned"]) + " bài · chọn " + J.S(r["selected"]) + " · " + J.S(r["message"]) + (J.S(r["preview"]).Length == 0 ? "" : "\nBản xem trước: " + J.S(r["preview"])); }); }
    void OpenSelected()
    {
        var ids = Ids; var epoch = ++openEpoch;
        Perform("Đang mở trình duyệt GPM…", async api => { var names = new List<string>(); foreach (var id in ids) { if (epoch != openEpoch) return "Đã hủy các lượt mở còn lại do Dừng."; var r = await api.Request("profile-open", new() { ["profileId"] = id, ["useCurrentProxy"] = true }); if (J.B(r["cancelled"])) return "Đã hủy yêu cầu mở do Dừng."; names.Add(J.S(r["profileName"])); } return "Đã mở: " + string.Join(", ", names) + ". Chưa chạy tự động."; });
    }
    public bool EditingProfileForm { get; set; }
    public Task<JsonObject> ParseProxy(string value) => api!.Request("proxy-parse", new() { ["proxy"] = value });
    void CreateProfile()
    {
        var values = FormDialog.Ask(this, "Tạo profile GPM", ("Tên profile", ""), ("Proxy · IP:port:user:pass (trống = không dùng)", ""), ("Chrome · để trống tự chọn", "")); if (values == null) return;
        Perform("Đang tạo profile GPM…", async api => { var r = await api.Request("profile-create", new() { ["name"] = values[0], ["proxy"] = values[1], ["browserVersion"] = values[2] }); await Refresh(); SelectOnly([J.S(J.O(r["profile"])["id"])]); return "Đã tạo profile. Bấm Mở trình duyệt để kiểm tra đăng nhập."; });
    }
    void EditProfile()
    {
        var row = Selected.Single(); var values = FormDialog.Ask(this, "Sửa profile", ("Tên", row.Name), ("Proxy", J.S(row.Data["proxy"]))); if (values == null) return;
        Perform("Đang cập nhật GPM…", async api => { await api.Request("profile-edit", new() { ["id"] = row.Id, ["name"] = values[0], ["proxy"] = values[1] }); return "Đã cập nhật tên và proxy."; });
    }
    void DeleteProfile()
    {
        var id = Ids.Single(); if (MessageBox.Show(this, "Chuyển profile vào thùng rác GPM và xóa khỏi bảng tool? Lịch sử trên máy được giữ.", "Xóa profile", MessageBoxButton.YesNo, MessageBoxImage.Question) != MessageBoxResult.Yes) return;
        Perform("Đang xóa profile…", async api => { await api.Request("profile-delete", new() { ["id"] = id }); return "Đã chuyển profile vào thùng rác GPM."; });
    }
    void ImportFile()
    {
        var dialog = new OpenFileDialog { Filter = "Danh sách profile|*.json;*.csv;*.txt" }; if (dialog.ShowDialog(this) != true) return;
        try { if (new FileInfo(dialog.FileName).Length > 5 * 1024 * 1024) throw new Exception("File tối đa 5 MB."); var text = File.ReadAllText(dialog.FileName, new UTF8Encoding(false, true)); new ProfilePicker(this, api!, new() { ["text"] = text, ["filename"] = Path.GetFileName(dialog.FileName) }).ShowDialog(); } catch (Exception e) { Message(e.Message, true); }
    }
    void ExportProfiles()
    {
        var ids = Selected.Any() ? Ids : allRows.Keys.ToArray(); if (ids.Length == 0) { Message("Chưa có profile để xuất.", true); return; }
        var choice = MessageBox.Show(this, $"Xuất {ids.Length} profile.\n\nCó: kèm proxy/cookie/phiên Threads (cần profile nguồn đã mở).\nKhông: chỉ ID và tên.\nHủy: không xuất.\n\nGói chuyển máy chứa dữ liệu đăng nhập; giữ file riêng tư.", "Xuất / chuyển máy", MessageBoxButton.YesNoCancel, MessageBoxImage.Question); if (choice == MessageBoxResult.Cancel) return;
        Perform("Đang xuất profile…", async api =>
        {
            var payload = choice == MessageBoxResult.Yes ? await api.Request("profiles-transfer-export", new() { ["ids"] = J.Strings(ids) }) : new JsonObject { ["format"] = "hoanxu-profile-list", ["version"] = 1, ["exportedAt"] = DateTimeOffset.UtcNow.ToString("O"), ["profiles"] = new JsonArray(ids.Select(id => (JsonNode)new JsonObject { ["id"] = id, ["name"] = allRows[id].Name }).ToArray()) };
            var dialog = new SaveFileDialog { FileName = choice == MessageBoxResult.Yes ? "hoanxu-transfer.json" : "hoanxu-profiles.json", Filter = "JSON|*.json" }; if (dialog.ShowDialog(this) != true) return "Đã hủy lưu file.";
            await File.WriteAllTextAsync(dialog.FileName, payload.ToJsonString(new JsonSerializerOptions { WriteIndented = true }), new UTF8Encoding(false)); return "Đã xuất file profile.";
        });
    }
    void ImportPrompt()
    {
        var d = new OpenFileDialog { Filter = "Prompt|*.txt" }; if (d.ShowDialog(this) != true) return;
        try { if (new FileInfo(d.FileName).Length > 200000) throw new Exception("Prompt quá lớn."); var text = File.ReadAllText(d.FileName, new UTF8Encoding(false, true)); if (text.Length > 50000) throw new Exception("Prompt tối đa 50.000 ký tự."); prompt.Text = text; } catch (Exception e) { Message(e.Message, true); }
    }
    void RenderLogs()
    {
        var selected = allRows.Values;
        var values = selected.SelectMany(p => J.Rows(J.O(p.Data["view"])["logs"]).Select(e => (Time: J.S(e["time"]), Text: p.Name + " → " + J.S(e["time"]) + " · " + J.S(e["message"])))).OrderByDescending(e => e.Time).Take(300).Select(e => e.Text);
        var text = string.Join(Environment.NewLine, values); if (logs.Text != text) logs.Text = text.Length == 0 ? "Chưa có nhật ký." : text;
        var recent = selected.SelectMany(p => J.Rows(J.O(p.Data["view"])["recent"]).Select(r => (Time: J.S(r["created_at"]), Text: p.Name + " → " + J.S(r["created_at"]) + " · " + J.S(r["state"]) + " · " + (J.S(r["comment_url"]).Length > 0 ? J.S(r["comment_url"]) : J.S(r["post_url"])) + (J.S(r["verification_error"]).Length > 0 ? " · " + J.S(r["verification_error"]) : "")))).OrderByDescending(r => r.Time).Take(300).Select(r => r.Text);
        var historyText = string.Join(Environment.NewLine, recent); if (history.Text != historyText) history.Text = historyText.Length == 0 ? "Chưa có lịch sử gửi bình luận." : historyText;
    }
    async Task LoadUpdate(bool check = true) { if (api == null) return; try { update = await api.Request("update-status"); RenderUpdate(); if (check) await CheckForUpdate(); } catch (Exception e) { updateText.Text = "Chưa đọc được phiên bản: " + e.Message; } }
    void RenderUpdate()
    {
        var current = J.S(update["currentVersion"]); var error = J.S(update["checkError"]); var available = J.B(update["available"]);
        versionText.Text = "Phiên bản " + current + (updateChecking ? " · đang kiểm tra…" : error.Length > 0 ? " · chưa kiểm tra được bản mới" : "");
        updateBanner.Visibility = available ? Visibility.Visible : Visibility.Collapsed;
        updateWarning.Text = "Bạn chưa dùng phiên bản mới nhất: " + current + " → " + J.S(update["latestVersion"]) + ". Dừng profile và lưu cài đặt trước khi cập nhật.";
        updateText.Text = available ? updateWarning.Text : error.Length > 0 ? "Chưa xác định được bản mới nhất: " + error : J.S(update["repository"]).Length == 0 ? "Cập nhật từ xa đang tắt · tải bản mới thủ công từ GitHub Releases." : update["checkedAt"] == null ? "Chưa kiểm tra phiên bản mới." : "Bạn đang dùng bản mới nhất · " + current;
        if (available) updateText.Text += "\nSau khi cập nhật: dừng và đóng profile, rồi bấm Chạy bằng extension để nạp lại bộ chạy.";
        if (J.S(update["repository"]).Length > 0) updateText.Text += "\nTự kiểm tra cập nhật mỗi phút khi app đang mở.";
        if (DateTimeOffset.TryParse(J.S(update["checkedAt"]), out var checkedAt))
            updateText.Text += "\nKiểm tra thành công gần nhất: " + checkedAt.ToLocalTime().ToString("dd/MM/yyyy HH:mm:ss");
        if (available && error.Length > 0) updateText.Text += "\nLần kiểm tra gần nhất lỗi: " + error;
        Controls();
    }
    async Task CheckForUpdate()
    {
        if (api == null || updateChecking || J.S(update["repository"]).Length == 0) return; updateChecking = true; lastUpdateCheck = DateTime.UtcNow; RenderUpdate();
        try { update = await api.Request("update-check", new()); } catch (Exception e) { update["checkError"] = e.Message; }
        finally { updateChecking = false; RenderUpdate(); }
    }
    void InstallUpdate() { if (dirty) { Message("Lưu cài đặt đang sửa trước khi cập nhật.", true); return; } Perform("Đang tải và xác minh bản cập nhật…", async api => { await api.Request("update-install", new()); return "Đang cài và mở lại app…"; }); }
    public void SelectOnly(IEnumerable<string> ids) { var set = ids.ToHashSet(); foreach (var p in allRows.Values) p.Selected = set.Contains(p.Id); search.Text = ""; category.SelectedIndex = 0; Controls(); }
    async Task Smoke()
    {
        if (api == null || !loaded || allRows.Count != 0) throw new Exception("Native smoke must start with isolated empty data.");
        model.Text = "cx/gpt-5.6-luna"; fields["restAverageSeconds"].Text = "60"; await Save(api);
        var saved = await api.Request("state"); if (J.S(J.O(saved["settings"])["model"]) != "cx/gpt-5.6-luna" || J.S(J.O(J.O(saved["settings"])["runConfig"])["restAverageSeconds"]) != "60") throw new Exception("Native settings save failed.");
        update = new() { ["currentVersion"] = "0.4.0", ["latestVersion"] = "0.4.1", ["available"] = true, ["installSupported"] = true, ["repository"] = "fixture/tool" }; RenderUpdate();
        if (updateBanner.Visibility != Visibility.Visible || !buttons["install-update-top"].IsEnabled || !updateWarning.Text.Contains("0.4.1")) throw new Exception("Native update warning/button failed.");
        update["available"] = false; update["checkError"] = "Fixture offline"; RenderUpdate();
        if (updateBanner.Visibility != Visibility.Collapsed || buttons["install-update-top"].IsEnabled || !updateText.Text.Contains("Chưa xác định")) throw new Exception("Offline update must not report latest.");
        Console.WriteLine("Native WPF startup, settings save and update warning passed."); await backend.Close(); closed = true; closing = true; Close();
    }
}

sealed class FormDialog : Window
{
    public static string[]? Ask(Window owner, string title, params (string Label, string Value)[] fields)
    {
        var dialog = new FormDialog { Owner = owner, Title = title, Width = 510, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner }; var page = new StackPanel { Margin = new(22) }; dialog.Content = page; var inputs = new List<TextBox>(); var parsing = false;
        foreach (var (label, value) in fields) { page.Children.Add(MainWindow.Note(label)); var input = new TextBox { Text = value, MinHeight = 30, Padding = new(6) }; inputs.Add(input);
            if (label.StartsWith("Proxy") && owner is MainWindow main) {
                var line = new DockPanel(); var parse = new Button { Content = "Parse", Padding = new(12, 5, 12, 5), Margin = new(8, 0, 0, 0) }; DockPanel.SetDock(parse, Dock.Right); line.Children.Add(parse); line.Children.Add(input); page.Children.Add(line);
                var note = MainWindow.Note("Parse chuẩn hóa định dạng · không kiểm tra kết nối"); page.Children.Add(note);
                parse.Click += async (_, _) => { parsing = true; parse.IsEnabled = false; note.Text = "Đang parse proxy…"; try { var r = await main.ParseProxy(input.Text); input.Text = J.S(r["proxy"]); note.Text = "Hợp lệ · " + J.S(r["label"]); } catch (Exception e) { note.Text = e.Message; } finally { parsing = false; parse.IsEnabled = true; } };
            } else page.Children.Add(input);
        }
        var ok = new Button { Content = "Lưu", IsDefault = true, Margin = new(0, 20, 10, 0), Padding = new(18, 6, 18, 6) }; ok.Click += (_, _) => { if (!parsing) dialog.DialogResult = true; }; var cancel = new Button { Content = "Hủy", IsCancel = true, Margin = new(0, 20, 0, 0), Padding = new(18, 6, 18, 6) }; page.Children.Add(MainWindow.Row(ok, cancel)); if (owner is MainWindow editing) editing.EditingProfileForm = true; try { return dialog.ShowDialog() == true ? inputs.Select(i => i.Text).ToArray() : null; } finally { if (owner is MainWindow finished) finished.EditingProfileForm = false; }
    }
}
