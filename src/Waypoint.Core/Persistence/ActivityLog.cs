using System.Text.Json;

namespace Waypoint.Core.Persistence;

public enum ActivityKind
{
    Connected,
    Disconnected,
    Discovered,
    Switched,
    SwitchFailed,
    ExternalChange,
    Reverted,
    Override,
    Restored,
    ModeChanged,
    PriorityChanged,
    Settings,
    Warning,
    Info,
}

public sealed record ActivityEntry
{
    public required long Id { get; init; }
    public required DateTimeOffset Time { get; init; }
    public required ActivityKind Kind { get; init; }
    public required string Title { get; init; }
    public string? Detail { get; init; }
    public string? DeviceId { get; init; }

    /// <summary>Set for microphone (capture) events; null for outputs and general events.</summary>
    public Audio.AudioFlow? Flow { get; init; }
}

/// <summary>
/// Append-only JSON-lines activity log, capped at <see cref="Capacity"/> entries in memory.
/// The file is compacted when it grows to twice the capacity. Not thread-safe; used from the runtime thread.
/// </summary>
public sealed class ActivityLog
{
    public const int Capacity = 2000;

    private readonly string _file;
    private readonly List<ActivityEntry> _entries = [];
    private long _nextId = 1;
    private int _linesOnDisk;

    public ActivityLog(AppPaths paths)
    {
        _file = paths.ActivityFile;
        LoadExisting();
    }

    public IReadOnlyList<ActivityEntry> Entries => _entries;

    public ActivityEntry Add(ActivityKind kind, string title, string? detail = null, string? deviceId = null, Audio.AudioFlow? flow = null)
    {
        var entry = new ActivityEntry
        {
            Id = _nextId++,
            Time = DateTimeOffset.Now,
            Kind = kind,
            Title = title,
            Detail = detail,
            DeviceId = deviceId,
            Flow = flow == Audio.AudioFlow.Capture ? flow : null,
        };

        _entries.Add(entry);
        if (_entries.Count > Capacity) _entries.RemoveRange(0, _entries.Count - Capacity);

        try
        {
            File.AppendAllText(_file, JsonSerializer.Serialize(entry, Json.Options) + Environment.NewLine);
            if (++_linesOnDisk > Capacity * 2) Compact();
        }
        catch (IOException)
        {
            // Logging must never break switching.
        }

        return entry;
    }

    public void Clear()
    {
        _entries.Clear();
        try { File.WriteAllText(_file, ""); } catch (IOException) { }
        _linesOnDisk = 0;
    }

    public string ExportText() =>
        string.Join(Environment.NewLine, _entries.Select(e =>
            $"{e.Time:yyyy-MM-dd HH:mm:ss}\t{e.Kind}\t{e.Title}{(e.Detail is null ? "" : " - " + e.Detail)}"));

    private void LoadExisting()
    {
        if (!File.Exists(_file)) return;
        try
        {
            foreach (var line in File.ReadLines(_file))
            {
                _linesOnDisk++;
                if (string.IsNullOrWhiteSpace(line)) continue;
                try
                {
                    var entry = JsonSerializer.Deserialize<ActivityEntry>(line, Json.Options);
                    if (entry is not null) _entries.Add(entry);
                }
                catch (JsonException)
                {
                    // Skip a torn line (e.g. power loss mid-write).
                }
            }
        }
        catch (IOException)
        {
            return;
        }

        if (_entries.Count > Capacity) _entries.RemoveRange(0, _entries.Count - Capacity);
        _nextId = _entries.Count == 0 ? 1 : _entries.Max(e => e.Id) + 1;
        if (_linesOnDisk > Capacity * 2) Compact();
    }

    private void Compact()
    {
        try
        {
            var temp = _file + ".tmp";
            File.WriteAllLines(temp, _entries.Select(e => JsonSerializer.Serialize(e, Json.Options)));
            File.Move(temp, _file, overwrite: true);
            _linesOnDisk = _entries.Count;
        }
        catch (IOException)
        {
        }
    }
}
