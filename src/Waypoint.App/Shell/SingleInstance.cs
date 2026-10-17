namespace Waypoint.App.Shell;

/// <summary>Ensures one Waypoint per user session; a second launch asks the first to show its window.</summary>
internal sealed class SingleInstance : IDisposable
{
    private const string MutexName = @"Local\Waypoint.SingleInstance.v1";
    private const string EventName = @"Local\Waypoint.Activate.v1";

    private readonly Mutex _mutex;
    private readonly EventWaitHandle _activate;
    private readonly RegisteredWaitHandle? _wait;

    private SingleInstance(Mutex mutex, EventWaitHandle activate, Action onActivate)
    {
        _mutex = mutex;
        _activate = activate;
        _wait = ThreadPool.RegisterWaitForSingleObject(activate, (_, _) => onActivate(), null, Timeout.Infinite, executeOnlyOnce: false);
    }

    /// <summary>Returns null (after signalling the running instance) if Waypoint is already running.</summary>
    public static SingleInstance? TryAcquire(Action onActivate)
    {
        var mutex = new Mutex(initiallyOwned: true, MutexName, out bool created);
        var activate = new EventWaitHandle(false, EventResetMode.AutoReset, EventName);
        if (!created)
        {
            activate.Set();
            activate.Dispose();
            mutex.Dispose();
            return null;
        }

        return new SingleInstance(mutex, activate, onActivate);
    }

    public void Dispose()
    {
        _wait?.Unregister(null);
        _activate.Dispose();
        try { _mutex.ReleaseMutex(); } catch (ApplicationException) { }
        _mutex.Dispose();
    }
}
