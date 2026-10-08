using System.Runtime.InteropServices;
using System.Security.Cryptography;
using System.Text;
using System.Windows;

namespace HoanXu;

static class Program
{
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern IntPtr FindWindow(string? className, string title);
    [DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr hwnd);
    [STAThread]
    public static int Main(string[] args)
    {
        var smoke = args.Contains("--smoke-test");
        var data = smoke ? Path.Combine(Path.GetTempPath(), "hoanxu-wpf-smoke-" + Guid.NewGuid()) : Environment.GetEnvironmentVariable("GPM_TOOL_DATA") ?? Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData), "HoanXu-GPM", "data");
        var id = Convert.ToHexString(SHA256.HashData(Encoding.UTF8.GetBytes(Path.GetFullPath(data))))[..16];
        using var mutex = new Mutex(true, "Local\\HoanXu-GPM-" + id, out var created);
        if (!created) { SetForegroundWindow(FindWindow(null, "Hoàn Xu · GPM Tool")); return 0; }
        var backend = new Backend(data);
        try
        {
            var app = new Application { ShutdownMode = ShutdownMode.OnMainWindowClose };
            app.DispatcherUnhandledException += (_, e) => { e.Handled = true; if (!smoke) MessageBox.Show(e.Exception.Message, "Hoàn Xu", MessageBoxButton.OK, MessageBoxImage.Error); else { Environment.ExitCode = 1; app.Shutdown(1); } };
            var code = app.Run(new MainWindow(backend, smoke)); return Environment.ExitCode != 0 ? Environment.ExitCode : code;
        }
        finally
        {
            if (backend.Process?.HasExited == false) { try { backend.Close().GetAwaiter().GetResult(); } catch { } }
            backend.Api?.Dispose(); if (smoke) { try { Directory.Delete(data, true); } catch { } }
        }
    }
}
