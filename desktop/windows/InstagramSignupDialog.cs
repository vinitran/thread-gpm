using System.Text.Json.Nodes;
using System.Windows;
using System.Windows.Controls;

namespace HoanXu;

static class InstagramSignupDialog
{
    public static JsonObject? Ask(Window owner, JsonObject draft)
    {
        var dialog = new Window { Owner = owner, Title = "Chuẩn bị đăng ký Instagram", Width = 560, SizeToContent = SizeToContent.Height, ResizeMode = ResizeMode.NoResize, WindowStartupLocation = WindowStartupLocation.CenterOwner };
        var page = new StackPanel { Margin = new(22) }; dialog.Content = page;
        page.Children.Add(MainWindow.Note("Mở đúng profile GPM và điền form. Bạn kiểm tra, tự Submit và hoàn tất xác minh trên Instagram."));
        var inputs = new Dictionary<string, TextBox>();
        foreach (var (key, title) in new[] { ("email", "Gmail · lấy từ tên profile"), ("fullName", "Tên nữ Việt Nam · AI gợi ý, có thể sửa"), ("username", "Username · AI gợi ý, có thể sửa") })
        {
            page.Children.Add(MainWindow.Note(title)); var field = new TextBox { Text = J.S(draft[key]), MinHeight = 30, Padding = new(6), Margin = new(0, 0, 0, 8) }; inputs[key] = field; page.Children.Add(field);
        }
        page.Children.Add(MainWindow.Note(J.B(draft["hasSavedPassword"]) ? "Mật khẩu cố định · đã lưu trên máy, để trống để dùng lại" : "Mật khẩu cố định · để trống để tự nhập trên Instagram"));
        var password = new PasswordBox { MinHeight = 30, Padding = new(6) }; page.Children.Add(password);
        var remember = new CheckBox { Content = "Nhớ mật khẩu trên máy cho lần sau", Margin = new(0, 12, 0, 12) }; page.Children.Add(remember);
        page.Children.Add(MainWindow.Note("Ngày sinh được chọn ngẫu nhiên trong năm 2004–2007. Giới tính: nữ nếu form có mục này. Mật khẩu chỉ lưu local khi tích Nhớ."));
        var open = new Button { Content = "Mở & điền form", IsDefault = true, Padding = new(18, 7, 18, 7) }; open.Click += (_, _) => dialog.DialogResult = true;
        var cancel = new Button { Content = "Hủy", IsCancel = true, Padding = new(18, 7, 18, 7), Margin = new(10, 0, 0, 0) }; page.Children.Add(MainWindow.Row(open, cancel));
        if (dialog.ShowDialog() != true) return null;
        var result = new JsonObject { ["password"] = password.Password, ["rememberPassword"] = remember.IsChecked == true }; foreach (var (key, field) in inputs) result[key] = field.Text; return result;
    }
}
