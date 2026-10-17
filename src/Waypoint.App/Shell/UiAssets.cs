using System.IO;
using System.Reflection;

namespace Waypoint.App.Shell;

/// <summary>Serves the Vite build (embedded as "ui/..." resources) to WebView2 under https://waypoint.local/.</summary>
internal sealed class UiAssets
{
    public const string Origin = "https://waypoint.local";

    private readonly Assembly _assembly = typeof(UiAssets).Assembly;
    private readonly Dictionary<string, string> _resources;

    public UiAssets()
    {
        // MSBuild's RecursiveDir uses backslashes; normalise to URL form.
        _resources = _assembly.GetManifestResourceNames()
            .Where(n => n.StartsWith("ui/", StringComparison.Ordinal))
            .ToDictionary(n => n[3..].Replace('\\', '/'), n => n, StringComparer.OrdinalIgnoreCase);
    }

    public bool HasUi => _resources.ContainsKey("index.html");

    public Stream? Open(Uri uri, out string contentType)
    {
        var path = Uri.UnescapeDataString(uri.AbsolutePath).TrimStart('/');
        if (path.Length == 0) path = "index.html";

        // SPA fallback: unknown extension-less paths load the app shell.
        if (!_resources.ContainsKey(path) && !Path.HasExtension(path)) path = "index.html";

        contentType = ContentType(path);
        return _resources.TryGetValue(path, out var name) ? _assembly.GetManifestResourceStream(name) : null;
    }

    private static string ContentType(string path) => Path.GetExtension(path).ToLowerInvariant() switch
    {
        ".html" => "text/html; charset=utf-8",
        ".js" or ".mjs" => "text/javascript; charset=utf-8",
        ".css" => "text/css; charset=utf-8",
        ".json" => "application/json",
        ".svg" => "image/svg+xml",
        ".png" => "image/png",
        ".ico" => "image/x-icon",
        ".woff2" => "font/woff2",
        ".woff" => "font/woff",
        ".ttf" => "font/ttf",
        _ => "application/octet-stream",
    };
}
