using System.Collections.ObjectModel;
using System.ComponentModel;
using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;
using System.Windows.Controls.Primitives;
using System.Windows.Data;

namespace HoanXu;

sealed class ImportRow : INotifyPropertyChanged
{
    public JsonObject Data = new();
    bool selected;
    public string Name => J.S(Data["name"]);
    public string Id => J.S(Data["id"]);
    public string Proxy => J.S(Data["proxy"]);
    public string Message => J.S(Data["message"]);
    public bool Ready => J.S(Data["status"]) == "ready";
    public bool Selected { get => selected; set { if (!Ready || selected == value) return; selected = value; PropertyChanged?.Invoke(this, new(nameof(Selected))); } }
    public event PropertyChangedEventHandler? PropertyChanged;
}

sealed class ProfilePicker : Window
{
    readonly MainWindow parent;
    readonly ToolApi api;
    readonly JsonObject? file;
    JsonObject preview = new();
    readonly ObservableCollection<ImportRow> rows = new();
    readonly TextBox query = new() { Width = 340, Margin = new(0, 0, 10, 0) }, chrome = new() { Width = 350, Margin = new(0, 0, 10, 0) };
    readonly ComboBox groups = new() { Width = 210, DisplayMemberPath = "Value", SelectedValuePath = "Key", Margin = new(0, 0, 10, 0) };
    readonly Button confirm = new() { Content = "Thêm profile đã chọn", Padding = new(14, 7, 14, 7), IsEnabled = false }, find = new() { Content = "Tìm kiếm", Padding = new(14, 7, 14, 7) };
    readonly TextBlock note = new() { TextWrapping = TextWrapping.Wrap, Margin = new(0, 10, 0, 10) };
    bool loading, fillingGroups;
    public ProfilePicker(MainWindow parent, ToolApi api, JsonObject? file = null)
    {
        this.parent = parent; this.api = api; this.file = file; Owner = parent; Title = file == null ? "Chọn profile có sẵn trong GPM" : "Nhập / khôi phục profile"; Width = 980; Height = 650; MinWidth = 850; MinHeight = 500; WindowStartupLocation = WindowStartupLocation.CenterOwner;
        var page = new DockPanel { Margin = new(20) }; Content = page; var top = new StackPanel(); top.Children.Add(MainWindow.Note(file == null ? "Tìm tên, một phần tên hoặc ID; có thể lọc theo nhóm GPM." : "File kèm phiên Threads sẽ tạo/mở GPM để khôi phục. Chrome máy đích có thể để trống."));
        groups.Items.Add(new KeyValuePair<string, string>("", "Tất cả nhóm")); groups.SelectedIndex = 0;
        top.Children.Add(file == null ? MainWindow.Row(query, groups, find) : MainWindow.Row(chrome, find)); DockPanel.SetDock(top, Dock.Top); page.Children.Add(top);
        var bottom = new StackPanel(); bottom.Children.Add(note); var all = new Button { Content = "Chọn tất cả hợp lệ", Padding = new(14, 7, 14, 7), Margin = new(0, 0, 10, 0) }; all.Click += (_, _) => { foreach (var p in rows) p.Selected = p.Ready; }; bottom.Children.Add(MainWindow.Row(all, confirm)); DockPanel.SetDock(bottom, Dock.Bottom); page.Children.Add(bottom);
        var grid = new DataGrid { AutoGenerateColumns = false, CanUserAddRows = false, CanUserDeleteRows = false, ItemsSource = rows, HeadersVisibility = DataGridHeadersVisibility.Column, RowHeight = 38 };
        var checkbox = new FrameworkElementFactory(typeof(CheckBox)); checkbox.SetBinding(ToggleButton.IsCheckedProperty, new Binding("Selected") { Mode = BindingMode.TwoWay, UpdateSourceTrigger = UpdateSourceTrigger.PropertyChanged }); checkbox.SetBinding(IsEnabledProperty, new Binding("Ready")); grid.Columns.Add(new DataGridTemplateColumn { Header = "✓", CellTemplate = new DataTemplate { VisualTree = checkbox }, Width = 40 });
        foreach (var (path, title, width) in new[] { ("Name", "Profile", 220d), ("Id", "ID", 250d), ("Message", "Kết quả đối chiếu", 390d) }) grid.Columns.Add(new DataGridTextColumn { Header = title, Binding = new Binding(path), Width = width, IsReadOnly = true });
        grid.PreviewMouseLeftButtonDown += (_, e) => { var source = e.OriginalSource as DependencyObject; if (MainWindow.Find<CheckBox>(source) != null) return; if (MainWindow.Find<DataGridRow>(source)?.Item is ImportRow value) { value.Selected = !value.Selected; e.Handled = true; } }; page.Children.Add(grid);
        find.Click += async (_, _) => await Load(); query.KeyDown += async (_, e) => { if (e.Key == System.Windows.Input.Key.Enter) await Load(); }; query.TextChanged += (_, _) => Invalidate(); chrome.TextChanged += (_, _) => Invalidate();
        groups.SelectionChanged += async (_, _) => { if (!fillingGroups) await Load(); }; confirm.Click += async (_, _) => await Commit(); Loaded += async (_, _) => await Load();
    }
    void Invalidate() { if (loading) return; preview = new(); rows.Clear(); confirm.IsEnabled = false; note.Text = "Danh sách đã đổi. Bấm Tìm kiếm để đối chiếu lại."; }
    async Task Load()
    {
        if (loading) return; loading = true; query.IsEnabled = chrome.IsEnabled = groups.IsEnabled = false; confirm.IsEnabled = false; find.IsEnabled = false; note.Text = "Đang đối chiếu profile GPM…";
        try
        {
            var group = groups.SelectedValue?.ToString() ?? "";
            var body = file?.DeepClone().AsObject() ?? new JsonObject { ["fromGpm"] = true, ["query"] = query.Text, ["groupId"] = group }; if (file != null) body["browserVersion"] = chrome.Text;
            preview = await api.Request("profiles-import-preview", body); rows.Clear();
            foreach (var p in J.Rows(preview["rows"])) { var row = new ImportRow { Data = p }; row.PropertyChanged += (_, _) => confirm.IsEnabled = !loading && rows.Any(p => p.Selected); rows.Add(row); }
            if (file == null) { fillingGroups = true; groups.Items.Clear(); groups.Items.Add(new KeyValuePair<string, string>("", "Tất cả nhóm")); foreach (var g in J.Rows(preview["groups"])) groups.Items.Add(new KeyValuePair<string, string>(J.S(g["id"]), J.S(g["name"]))); groups.SelectedValue = group; if (groups.SelectedIndex < 0) groups.SelectedIndex = 0; fillingGroups = false; }
            note.Text = $"{rows.Count} dòng · bấm dòng để chọn. " + (J.B(preview["limited"]) ? "Giới hạn 500 kết quả; dùng tên/nhóm để thu hẹp. " : "") + J.S(preview["groupsWarning"]);
            confirm.Content = J.B(preview["transfer"]) ? "Khôi phục profile đã chọn" : "Thêm profile đã chọn";
        }
        catch (Exception e) { note.Text = e.Message; }
        finally { loading = false; query.IsEnabled = chrome.IsEnabled = groups.IsEnabled = true; find.IsEnabled = true; confirm.IsEnabled = rows.Any(p => p.Selected); }
    }
    async Task Commit()
    {
        if (loading) return; var ids = rows.Where(p => p.Selected && p.Ready).Select(p => p.Id).ToArray(); if (ids.Length == 0) return; loading = true; query.IsEnabled = chrome.IsEnabled = groups.IsEnabled = false; confirm.IsEnabled = false; find.IsEnabled = false;
        try
        {
            var results = new List<JsonObject>(); foreach (var chunk in ids.Chunk(500)) { note.Text = $"Đang nhập {results.Count} / {ids.Length} profile…"; var r = await api.Request("profiles-import", new() { ["token"] = J.S(preview["token"]), ["ids"] = J.Strings(chunk) }); results.AddRange(J.Rows(r["results"])); }
            var added = results.Where(p => J.S(p["status"]) == "imported").ToArray(); await parent.Refresh(); parent.SelectOnly(added.Select(p => J.S(p["id"])));
            var errors = results.Where(p => J.S(p["status"]) != "imported").ToArray(); note.Text = $"Đã thêm {added.Length} profile. Kiểm tra đăng nhập trước khi chạy tự động. " + string.Join(" · ", errors.Select(p => J.S(p["message"])));
            if (errors.Length == 0) { MessageBox.Show(this, note.Text, "Đã nhập", MessageBoxButton.OK, MessageBoxImage.Information); Close(); }
        }
        catch (Exception e) { note.Text = e.Message; }
        finally { loading = false; query.IsEnabled = chrome.IsEnabled = groups.IsEnabled = true; find.IsEnabled = true; confirm.IsEnabled = rows.Any(p => p.Selected); }
    }
}
