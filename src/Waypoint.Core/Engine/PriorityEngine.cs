using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Engine;

public enum OverrideSource
{
    /// <summary>The user picked a device inside Waypoint (window or tray).</summary>
    App,

    /// <summary>The default was changed outside Waypoint (Windows Settings, another app) and BALANCED respected it.</summary>
    External,
}

public sealed record ManualOverride(string DeviceId, OverrideSource Source, DateTimeOffset Since);

/// <summary>Pure, side-effect-free priority rules. Everything here is unit tested.</summary>
public static class PriorityEngine
{
    /// <summary>Whether a device may be chosen automatically.</summary>
    public static bool IsEligible(AudioEndpoint e, AppSettings app, FlowSettings flow) =>
        e.IsAvailable && !IsExcluded(e, app, flow);

    public static bool IsExcluded(AudioEndpoint e, AppSettings app, FlowSettings flow) =>
        flow.Excluded.Contains(e.Id) || IsAutoExcluded(e, app);

    /// <summary>
    /// Excluded by a global rule rather than by the user's per-device toggle. Hands-Free endpoints are only ignored
    /// for outputs — for inputs the Hands-Free endpoint is the only way to use a Bluetooth headset's microphone.
    /// </summary>
    public static bool IsAutoExcluded(AudioEndpoint e, AppSettings app) =>
        (app.IgnoreHandsFree && e.IsHandsFree && e.Flow == AudioFlow.Render)
        || (!app.ShowVirtualDevices && e.Connection == ConnectionType.Virtual);

    /// <summary>
    /// The device Waypoint wants as default: an active manual override if its device is still available,
    /// otherwise the highest-ranked eligible device. Null if nothing ranked is available.
    /// </summary>
    public static AudioEndpoint? SelectTarget(IReadOnlyCollection<AudioEndpoint> endpoints, AppSettings app, FlowSettings flow, ManualOverride? manual)
    {
        var byId = endpoints.ToDictionary(e => e.Id);

        if (manual is not null && byId.TryGetValue(manual.DeviceId, out var pinned) && pinned.IsAvailable)
            return pinned;

        foreach (var id in flow.Priority)
        {
            if (byId.TryGetValue(id, out var e) && IsEligible(e, app, flow))
                return e;
        }

        return null;
    }

    /// <summary>The top eligible device ignoring any override (what "Restore priority" would pick).</summary>
    public static AudioEndpoint? SelectPriorityTarget(IReadOnlyCollection<AudioEndpoint> endpoints, AppSettings app, FlowSettings flow) =>
        SelectTarget(endpoints, app, flow, null);

    /// <summary>
    /// The next/previous connected device after <paramref name="currentId"/> in priority order (wrapping), for
    /// cycling with a hotkey. Auto-ignored endpoints are skipped; user exclusions are not (cycling is manual).
    /// </summary>
    public static AudioEndpoint? Cycle(IReadOnlyCollection<AudioEndpoint> endpoints, AppSettings app, FlowSettings flow, string? currentId, int direction)
    {
        var byId = endpoints.ToDictionary(e => e.Id);
        var candidates = flow.Priority
            .Where(id => byId.TryGetValue(id, out var e) && e.IsAvailable && !IsAutoExcluded(e, app))
            .Select(id => byId[id])
            .ToList();
        if (candidates.Count == 0) return null;

        int index = candidates.FindIndex(e => e.Id == currentId);
        int next = index < 0
            ? (direction > 0 ? 0 : candidates.Count - 1)
            : ((index + Math.Sign(direction)) % candidates.Count + candidates.Count) % candidates.Count;
        return candidates[next];
    }

    /// <summary>
    /// Returns the priority list with any unknown endpoints added. On a first run (empty list) devices are seeded
    /// in a sensible default order; afterwards new devices are appended so the user's ranking is never reshuffled.
    /// </summary>
    public static List<string> MergeNewDevices(IReadOnlyList<string> priority, IEnumerable<AudioEndpoint> endpoints, out List<AudioEndpoint> added)
    {
        var known = new HashSet<string>(priority);
        added = endpoints.Where(e => !known.Contains(e.Id)).ToList();
        if (added.Count == 0) return [.. priority];

        var seeded = added
            .OrderBy(DefaultRank)
            .ThenBy(e => e.IsAvailable ? 0 : 1)
            .ThenBy(e => e.FriendlyName, StringComparer.CurrentCultureIgnoreCase)
            .Select(e => e.Id);

        return [.. priority, .. seeded];
    }

    /// <summary>Applies a user reorder: ids in the given order, followed by any known ids the UI did not send.</summary>
    public static List<string> ApplyReorder(IReadOnlyList<string> current, IReadOnlyList<string> requested)
    {
        var known = new HashSet<string>(current);
        var result = requested.Where(known.Contains).Distinct().ToList();
        var seen = new HashSet<string>(result);
        result.AddRange(current.Where(id => !seen.Contains(id)));
        return result;
    }

    /// <summary>Lower is better. Personal audio first, then external speakers, built-in speakers last.</summary>
    internal static int DefaultRank(AudioEndpoint e) => (e.Connection, e.Kind) switch
    {
        (ConnectionType.Bluetooth, DeviceKind.Earbuds or DeviceKind.Headphones) => 0,
        (ConnectionType.Usb, DeviceKind.Microphone) => 0,
        (ConnectionType.Bluetooth, _) => 1,
        (ConnectionType.Usb, DeviceKind.Headphones or DeviceKind.Headset or DeviceKind.Earbuds) => 2,
        (ConnectionType.BuiltIn, DeviceKind.Headphones) => 3,
        (ConnectionType.Usb, _) => 4,
        (ConnectionType.Display, _) => 5,
        (ConnectionType.BuiltIn, DeviceKind.Microphone) => 5,
        (ConnectionType.BuiltIn, _) => 6,
        (ConnectionType.Other, _) => 7,
        (ConnectionType.BluetoothHandsFree, _) => 8,
        _ => 9,
    };
}
