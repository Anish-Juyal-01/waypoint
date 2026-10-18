using System.Collections.Concurrent;
using Waypoint.Core.Audio;
using Waypoint.Core.Persistence;

namespace Waypoint.Core.Engine;

/// <summary>
/// Hosts <see cref="WaypointService"/> and the audio system on one dedicated MTA thread (an actor):
/// COM notifications, timers and UI commands are all queued onto it, so the service needs no locks.
/// Public methods are thread-safe; events are raised on the runtime thread.
/// </summary>
public sealed class WaypointRuntime : IDisposable
{
    private const int MeterIntervalMs = 33;
    private const int VolumePollEvery = 8; // ~4 Hz

    private readonly BlockingCollection<Action> _queue = new();
    private readonly Func<IAudioSystem> _audioFactory;
    private readonly AppPaths _paths;
    private readonly IStartupRegistration? _startup;
    private readonly IShortcutRegistration? _shortcut;
    private readonly Thread _thread;
    private readonly TaskCompletionSource _ready = new(TaskCreationOptions.RunContinuationsAsynchronously);
    private readonly object _meterLock = new();

    private IAudioSystem? _audio;
    private WaypointService? _service;
    private Timer? _meterTimer;
    private int _meterTicks;
    private volatile bool _micMonitorRequested;
    private volatile bool _meterOn;
    private bool _disposed;

    public WaypointRuntime(Func<IAudioSystem> audioFactory, AppPaths paths, IStartupRegistration? startup, IShortcutRegistration? shortcut = null)
    {
        _shortcut = shortcut;
        _audioFactory = audioFactory;
        _paths = paths;
        _startup = startup;
        _thread = new Thread(Run) { IsBackground = true, Name = "Waypoint runtime" };
        _thread.SetApartmentState(ApartmentState.MTA);
    }

    public event Action<RuntimeSnapshot>? StateChanged;
    public event Action<ActivityEntry>? ActivityAdded;
    public event Action<SwitchEvent>? Switched;
    public event Action<OsdMessage>? Osd;

    /// <summary>Peak levels 0..1 of the current default output and microphone (only while the meter is enabled).</summary>
    public event Action<float?, float?>? Levels;

    /// <summary>Completes once the audio system is up and the first snapshot was published.</summary>
    public Task Ready => _ready.Task;

    public RuntimeSnapshot? LastSnapshot { get; private set; }

    public void Start() => _thread.Start();

    public void Post(Action<WaypointService> command) => Enqueue(() =>
    {
        if (_service is not null) command(_service);
    });

    /// <summary>Runs a query on the runtime thread and returns its result.</summary>
    public Task<T> Query<T>(Func<WaypointService, T> query)
    {
        var tcs = new TaskCompletionSource<T>(TaskCreationOptions.RunContinuationsAsynchronously);
        Enqueue(() =>
        {
            try
            {
                tcs.SetResult(query(_service ?? throw new InvalidOperationException("Runtime not started.")));
            }
            catch (Exception ex)
            {
                tcs.SetException(ex);
            }
        });
        return tcs.Task;
    }

    /// <summary>Enables the ~30 Hz peak meter and volume polling (enable only while the window is visible).</summary>
    public void SetMeterEnabled(bool enabled)
    {
        _meterOn = enabled;
        if (!enabled) Enqueue(() => _service?.SyncCaptureMonitor(false));
        lock (_meterLock)
        {
            if (enabled)
            {
                _meterTimer ??= new Timer(_ => Enqueue(SampleMeters), null, 0, MeterIntervalMs);
            }
            else
            {
                _meterTimer?.Dispose();
                _meterTimer = null;
            }
        }
    }

    /// <summary>
    /// The UI shows the microphone page and wants the mic level: keeps a silent capture stream open on the default
    /// mic while the meter runs (Windows shows its "microphone in use" indicator meanwhile).
    /// </summary>
    public void SetMicMonitor(bool wanted)
    {
        _micMonitorRequested = wanted;
        Enqueue(() => _service?.SyncCaptureMonitor(wanted && _meterOn));
    }

    public void Dispose()
    {
        if (_disposed) return;
        _disposed = true;
        SetMeterEnabled(false);
        _queue.CompleteAdding();
        _thread.Join(TimeSpan.FromSeconds(2));
    }

    private void Enqueue(Action action)
    {
        if (_queue.IsAddingCompleted) return;
        try
        {
            _queue.Add(action);
        }
        catch (InvalidOperationException)
        {
            // Shutting down.
        }
    }

    private void Run()
    {
        try
        {
            _audio = _audioFactory();
            var store = new SettingsStore(_paths);
            var settings = store.Load();
            var log = new ActivityLog(_paths);
            if (store.RecoveredFromCorruption is { } msg) log.Add(ActivityKind.Warning, "Settings were reset", msg);

            _service = new WaypointService(_audio, settings, log, new QueueScheduler(this), store, _startup, _shortcut);
            _service.StateChanged += s =>
            {
                LastSnapshot = s;
                StateChanged?.Invoke(s);
            };
            _service.ActivityAdded += e => ActivityAdded?.Invoke(e);
            _service.Switched += e => Switched?.Invoke(e);
            _service.Osd += m => Osd?.Invoke(m);
            _audio.Notification += n => Enqueue(() =>
            {
                (_audio as CoreAudioSystem)?.OnTopologyNotification(n);
                _service.OnAudioNotification(n);
            });

            _service.Initialize();
            LastSnapshot = _service.Snapshot();
            _ready.TrySetResult();
        }
        catch (Exception ex)
        {
            _ready.TrySetException(ex);
            return;
        }

        foreach (var action in _queue.GetConsumingEnumerable())
        {
            try
            {
                action();
            }
            catch (Exception ex)
            {
                // A bad command must not kill the runtime thread.
                try { ActivityAdded?.Invoke(new ActivityEntry { Id = 0, Time = DateTimeOffset.Now, Kind = ActivityKind.Warning, Title = "Internal error", Detail = ex.Message }); }
                catch { }
            }
        }

        _audio?.Dispose();
    }

    private void SampleMeters()
    {
        if (_service is null) return;
        // Follows the default mic if it changes while the page is open (no-op when nothing changed).
        _service.SyncCaptureMonitor(_micMonitorRequested && _meterOn);
        var (output, input) = _service.SampleLevels();
        Levels?.Invoke(output, input);
        if (++_meterTicks % VolumePollEvery == 0) _service.PollVolumes();
    }

    private sealed class QueueScheduler(WaypointRuntime runtime) : IRuntimeScheduler
    {
        public DateTimeOffset Now => DateTimeOffset.Now;

        public IDisposable Schedule(TimeSpan delay, Action action)
        {
            var handle = new ScheduledAction(action);
            if (delay <= TimeSpan.Zero)
            {
                runtime.Enqueue(handle.Run);
                return handle;
            }

            handle.Timer = new Timer(_ => runtime.Enqueue(handle.Run), null, delay, Timeout.InfiniteTimeSpan);
            return handle;
        }
    }

    private sealed class ScheduledAction(Action action) : IDisposable
    {
        private volatile bool _cancelled;
        public Timer? Timer { get; set; }

        public void Run()
        {
            if (_cancelled) return;
            _cancelled = true;
            Timer?.Dispose();
            action();
        }

        public void Dispose()
        {
            _cancelled = true;
            Timer?.Dispose();
        }
    }
}
