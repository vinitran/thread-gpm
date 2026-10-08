using System.Diagnostics;
using System.Net.Http;
using System.Text;
using System.Text.Json.Nodes;

namespace HoanXu;

static class J
{
    public static string S(JsonNode? node) => node?.ToString() ?? "";
    public static bool B(JsonNode? node) => node is JsonValue v && v.TryGetValue<bool>(out var result) && result;
    public static JsonObject O(JsonNode? node) => node as JsonObject ?? new();
    public static IEnumerable<JsonObject> Rows(JsonNode? node) => (node as JsonArray ?? new()).OfType<JsonObject>();
    public static JsonArray Strings(IEnumerable<string> values) => new(values.Select(v => JsonValue.Create(v) as JsonNode).ToArray());
}

sealed class ToolApi(string address) : IDisposable
{
    readonly HttpClient http = new() { Timeout = TimeSpan.FromMinutes(6) };
    string token = "";
    public string Address { get; } = address.TrimEnd('/');
    public async Task<JsonObject> Request(string route, JsonObject? body = null, bool retry = true)
    {
        if (body != null && token.Length == 0) await Request("state");
        using var request = new HttpRequestMessage(body == null ? HttpMethod.Get : HttpMethod.Post, Address + "/api/" + route);
        if (body != null)
        {
            request.Content = new StringContent(body.ToJsonString(), Encoding.UTF8, "application/json");
            request.Headers.Add("Origin", Address); request.Headers.Add("X-Tool-Token", token);
        }
        using var response = await http.SendAsync(request);
        var result = J.O(JsonNode.Parse(await response.Content.ReadAsStringAsync()));
        if ((int)response.StatusCode == 403 && retry && J.S(result["error"]) == "Invalid origin/token") { await Request("state"); return await Request(route, body, false); }
        if (!response.IsSuccessStatusCode) throw new Exception(J.S(result["error"]) is { Length: > 0 } error ? error : "Không kết nối được tool.");
        if (route == "state") token = J.S(result["token"]);
        return result;
    }
    public void Dispose() => http.Dispose();
}

sealed class Backend
{
    public string DataPath { get; }
    public Process? Process { get; private set; }
    public ToolApi? Api { get; private set; }
    public event Action<int>? Exited;
    public Backend(string dataPath) { DataPath = dataPath; Directory.CreateDirectory(dataPath); }
    public async Task Start()
    {
        var payload = AppContext.BaseDirectory;
        var info = new ProcessStartInfo(Path.Combine(payload, "node.exe"), "\"" + Path.Combine(payload, "gpm-tool", "server.mjs") + "\"") { UseShellExecute = false, CreateNoWindow = true, RedirectStandardOutput = true, RedirectStandardError = true, WorkingDirectory = Path.Combine(payload, "gpm-tool") };
        info.Environment["GPM_TOOL_DATA"] = DataPath; info.Environment["PORT"] = Environment.GetEnvironmentVariable("PORT") ?? "0";
        var ready = new TaskCompletionSource<string>(TaskCreationOptions.RunContinuationsAsynchronously);
        var p = new Process { StartInfo = info, EnableRaisingEvents = true }; Process = p;
        void Output(string? line)
        {
            if (line == null) return;
            try { lock (p) File.AppendAllText(Path.Combine(DataPath, "app.log"), line + Environment.NewLine); } catch { }
            if (line.StartsWith("GPM tool UI: ")) ready.TrySetResult(line[13..].Trim());
        }
        p.OutputDataReceived += (_, e) => Output(e.Data); p.ErrorDataReceived += (_, e) => Output(e.Data);
        p.Exited += (_, _) => { ready.TrySetException(new Exception("Backend đã thoát. Xem app.log trong thư mục dữ liệu.")); Exited?.Invoke(p.ExitCode); };
        if (!p.Start()) throw new Exception("Không khởi động được backend."); p.BeginOutputReadLine(); p.BeginErrorReadLine();
        Api = new ToolApi(await ready.Task.WaitAsync(TimeSpan.FromSeconds(30)));
    }
    public async Task Close()
    {
        if (Process == null || Process.HasExited) return;
        if (Api != null) await Api.Request("app-quit", new());
        await Process.WaitForExitAsync().WaitAsync(TimeSpan.FromSeconds(20));
    }
    public void LaunchUpdater()
    {
        var request = J.O(JsonNode.Parse(File.ReadAllText(Path.Combine(DataPath, "update-install.json"))));
        var source = J.S(request["source"]); var target = Environment.GetEnvironmentVariable("GPM_TOOL_EXE_PATH");
        if (target == null || !string.Equals(target, J.S(request["target"]), StringComparison.OrdinalIgnoreCase) || !int.TryParse(Environment.GetEnvironmentVariable("GPM_TOOL_PORTABLE_PID"), out var pid) || pid <= 0 || !Path.GetFullPath(source).StartsWith(Path.Combine(Path.GetFullPath(DataPath), "updates") + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase)) throw new Exception("Thông tin cập nhật portable không hợp lệ.");
        var helper = Path.Combine(DataPath, "updates", "helper-" + Guid.NewGuid() + ".ps1"); File.Copy(Path.Combine(AppContext.BaseDirectory, "update.ps1"), helper);
        var info = new ProcessStartInfo("powershell.exe") { UseShellExecute = false, CreateNoWindow = true };
        foreach (var argument in new[] { "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", helper, "-Source", source, "-Target", target, "-PortablePid", pid.ToString(), "-DataPath", DataPath }) info.ArgumentList.Add(argument);
        _ = System.Diagnostics.Process.Start(info) ?? throw new Exception("Không mở được bộ cài cập nhật.");
    }
}
