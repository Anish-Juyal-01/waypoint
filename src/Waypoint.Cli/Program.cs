using Waypoint.Core.Audio;

// waypoint-cli — diagnostics for the Waypoint audio layer.
//   waypoint-cli list                 list render endpoints and the current defaults
//   waypoint-cli props <index|id>     dump the endpoint's property store
//   waypoint-cli switch <index|id>    set the default output (verified) [--comm to include Communications]
//   waypoint-cli volume <index|id> [0-100|mute|unmute]   read or set master volume
//   waypoint-cli watch                print endpoint notifications until Ctrl+C
//   waypoint-cli meter                print the default device's peak level for a few seconds (with --input it
//                                     opens the same silent monitor stream the app uses, since mics aren't metered otherwise)
// Add --input to any command to work with microphones instead of outputs.

internal static class Program
{
    [MTAThread]
    private static int Main(string[] args)
    {
        using var audio = new CoreAudioSystem();
        var command = args.FirstOrDefault() ?? "list";
        var flow = args.Contains("--input") ? AudioFlow.Capture : AudioFlow.Render;
        args = args.Where(a => a != "--input").ToArray();
        var endpoints = audio.GetEndpoints(flow);

        switch (command)
        {
            case "list":
                PrintList(audio, endpoints, flow);
                return 0;

            case "props":
                {
                    var ep = Resolve(endpoints, args.ElementAtOrDefault(1));
                    if (ep is null) return Fail("Unknown device.");
                    Console.WriteLine(ep.FriendlyName);
                    foreach (var (key, value) in audio.DumpProperties(ep.Id))
                        Console.WriteLine($"  {key,-48} {value}");
                    return 0;
                }

            case "switch":
                {
                    var ep = Resolve(endpoints, args.ElementAtOrDefault(1));
                    if (ep is null) return Fail("Unknown device.");
                    Console.WriteLine($"Policy interface: {audio.PolicyVariant ?? "unavailable: " + audio.SwitchUnavailableReason}");
                    var result = audio.SetDefault(flow, ep.Id, args.Contains("--comm"));
                    Console.WriteLine($"{(result.Verified ? "VERIFIED" : "FAILED")}: {result.Message}");
                    PrintList(audio, audio.GetEndpoints(flow), flow);
                    return result.Verified ? 0 : 2;
                }

            case "volume":
                {
                    var ep = Resolve(endpoints, args.ElementAtOrDefault(1));
                    if (ep is null) return Fail("Unknown device.");
                    var arg = args.ElementAtOrDefault(2);
                    VolumeInfo? v = arg switch
                    {
                        null => audio.GetVolume(ep.Id),
                        "mute" => audio.SetMute(ep.Id, true),
                        "unmute" => audio.SetMute(ep.Id, false),
                        _ when int.TryParse(arg, out var pct) => audio.SetVolume(ep.Id, pct / 100f),
                        _ => null,
                    };
                    if (v is null) return Fail("Volume unavailable (device not connected?).");
                    Console.WriteLine($"{ep.FriendlyName}: {v.Level:P0}{(v.Muted ? " (muted)" : "")}");
                    return 0;
                }

            case "sessions":
                {
                    var d = audio.GetDefaults(flow);
                    Console.WriteLine(audio.CanRouteApps ? "Per-app routing: available" : $"Per-app routing: {audio.AppRoutingUnavailableReason}");
                    foreach (var ep in endpoints.Where(e => e.IsAvailable))
                    {
                        Console.WriteLine($"{(ep.Id == d.Console ? "*" : " ")} {ep.FriendlyName}");
                        foreach (var s in audio.GetSessions(ep.Id))
                        {
                            var route = s.IsSystemSounds ? null : audio.GetAppRoute(s.ProcessId, flow);
                            var routeText = route is null ? "" : route.Length == 0 ? "  · follows default" : $"  · PINNED to {Name(endpoints, route)}";
                            Console.WriteLine($"     {(s.State == 1 ? "ACTIVE  " : s.State == 0 ? "inactive" : "expired ")} {s.ProcessName} ({s.ProcessId}){(s.IsSystemSounds ? " [system sounds]" : "")}{routeText}");
                        }
                    }
                    return 0;
                }

            case "route":
                {
                    // waypoint-cli route <pid> <index|id|clear>
                    if (!uint.TryParse(args.ElementAtOrDefault(1), out var pid)) return Fail("Usage: route <pid> <index|id|clear>");
                    var target = args.ElementAtOrDefault(2);
                    var id = target == "clear" ? "" : Resolve(endpoints, target)?.Id;
                    if (id is null) return Fail("Unknown device.");
                    int hr = audio.SetAppRoute(pid, flow, id, includeCommunications: true);
                    Console.WriteLine(hr == 0 ? "route set" : $"failed 0x{hr:X8}");
                    Console.WriteLine($"read back: '{audio.GetAppRoute(pid, flow)}'");
                    return hr == 0 ? 0 : 2;
                }

            case "meter":
                {
                    var id = audio.GetDefaults(flow).Multimedia;
                    if (id is null) return Fail("No default device.");
                    if (flow == AudioFlow.Capture)
                        Console.WriteLine(audio.SetCaptureMonitor(id) ? "Monitor stream open." : $"Monitor failed: {audio.MonitorError}");
                    for (int i = 0; i < 25; i++)
                    {
                        var p = audio.GetPeak(id) ?? -1;
                        Console.WriteLine($"{p,6:0.0000} {new string('#', (int)(Math.Sqrt(Math.Max(0, p)) * 40))}");
                        Thread.Sleep(150);
                    }
                    audio.SetCaptureMonitor(null);
                    return 0;
                }

            case "watch":
                audio.Notification += n => Console.WriteLine($"{DateTime.Now:HH:mm:ss.fff} {n.Kind,-16} {n.Flow} {n.DeviceId}");
                Console.WriteLine("Watching endpoint notifications. Ctrl+C to exit.");
                Thread.Sleep(Timeout.Infinite);
                return 0;

            default:
                return Fail($"Unknown command '{command}'.");
        }
    }

    private static void PrintList(CoreAudioSystem audio, IReadOnlyList<AudioEndpoint> endpoints, AudioFlow flow)
    {
        var d = audio.GetDefaults(flow);
        for (int i = 0; i < endpoints.Count; i++)
        {
            var e = endpoints[i];
            var marks = (e.Id == d.Console ? "C" : "-") + (e.Id == d.Multimedia ? "M" : "-") + (e.Id == d.Communications ? "K" : "-");
            Console.WriteLine($"[{i,2}] {marks} {e.State,-10} {e.Connection,-18} {e.Kind,-10} ff={e.FormFactor,-2} {e.FriendlyName}  |  {e.AdapterName}");
        }
        Console.WriteLine($"Default console={Name(endpoints, d.Console)} multimedia={Name(endpoints, d.Multimedia)} comms={Name(endpoints, d.Communications)}");
        Console.WriteLine($"Switching: {(audio.CanSwitch ? "available via " + audio.PolicyVariant : "UNAVAILABLE " + audio.SwitchUnavailableReason)}");
    }

    private static string Name(IReadOnlyList<AudioEndpoint> eps, string? id) => eps.FirstOrDefault(e => e.Id == id)?.FriendlyName ?? "(none)";

    private static AudioEndpoint? Resolve(IReadOnlyList<AudioEndpoint> eps, string? arg) =>
        int.TryParse(arg, out var i) && i >= 0 && i < eps.Count ? eps[i] : eps.FirstOrDefault(e => e.Id == arg);

    private static int Fail(string message)
    {
        Console.Error.WriteLine(message);
        return 1;
    }
}
