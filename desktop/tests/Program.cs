using System.Net;
using System.Net.Sockets;
using System.Text;
using System.Text.Json.Nodes;
using HoanXu;

static void Check(bool value, string message) { if (!value) throw new Exception(message); }
var reservation = new TcpListener(IPAddress.Loopback, 0); reservation.Start();
var port = ((IPEndPoint)reservation.LocalEndpoint).Port; reservation.Stop();
var address = "http://127.0.0.1:" + port;
using var listener = new HttpListener(); listener.Prefixes.Add(address + "/"); listener.Start();
var calls = new List<string>(); int states = 0, probes = 0;
var serving = Task.Run(async () => {
    while (calls.Count < 7) {
        var context = await listener.GetContextAsync().WaitAsync(TimeSpan.FromSeconds(10));
        var request = context.Request; var route = request.Url!.AbsolutePath; calls.Add(route);
        JsonObject result;
        if (route == "/api/state") { states++; result = new() { ["token"] = states == 1 ? "expired-fixture" : "current-fixture" }; }
        else {
            Check(request.HttpMethod == "POST", "Mutation must use POST");
            Check(request.Headers["Origin"] == address, "Origin must match loopback host without trailing slash");
            using var reader = new StreamReader(request.InputStream); var body = JsonNode.Parse(await reader.ReadToEndAsync())!.AsObject();
            if (route == "/api/gpm-check" && ++probes == 1) {
                Check(request.Headers["X-Tool-Token"] == "expired-fixture", "First token missing");
                context.Response.StatusCode = 403; result = new() { ["error"] = "Invalid origin/token" };
            } else {
                Check(request.Headers["X-Tool-Token"] == "current-fixture", "Refreshed token missing");
                if (route == "/api/gpm-check") Check(body["gpmApi"]!.ToString() == "http://127.0.0.1:19995/api/v3", "Retry lost GPM address");
                else if (route == "/api/profile-open") Check(J.S(body["profileId"]) == "qa" && J.B(body["useCurrentProxy"]), "Open must use GPM's current proxy");
                else if (route == "/api/profiles-close") Check(body["ids"]![0]!.ToString() == "qa", "Stop must address selected profile");
                else if (route == "/api/settings") Check(J.S(body["scope"]) == "all", "Save must apply globally");
                else throw new Exception("Unexpected route: " + route);
                result = new() { ["ok"] = true };
            }
        }
        var bytes = Encoding.UTF8.GetBytes(result.ToJsonString()); context.Response.ContentType = "application/json"; context.Response.ContentLength64 = bytes.Length;
        await context.Response.OutputStream.WriteAsync(bytes); context.Response.Close();
    }
});
var previousProxy = HttpClient.DefaultProxy;
try {
    HttpClient.DefaultProxy = new RejectProxy();
    using var api = new ToolApi(address + "/");
    await api.Request("gpm-check", new() { ["gpmApi"] = "http://127.0.0.1:19995/api/v3" });
    await api.Request("profile-open", new() { ["profileId"] = "qa", ["useCurrentProxy"] = true });
    await api.Request("profiles-close", new() { ["ids"] = J.Strings(["qa"]) });
    await api.Request("settings", new() { ["scope"] = "all" });
    await serving; Check(states == 2 && probes == 2, "Must refresh expired token and retry exactly once");
    Console.WriteLine("PASS: Windows API client bypasses system proxy, refreshes token, preserves Origin and sends GPM open/stop/global settings requests.");
} finally { HttpClient.DefaultProxy = previousProxy; listener.Stop(); }

sealed class RejectProxy : IWebProxy {
    public ICredentials? Credentials { get; set; }
    public bool IsBypassed(Uri host) => false;
    public Uri GetProxy(Uri destination) => throw new Exception("Local backend was incorrectly sent through the system proxy");
}
