namespace GhostManual.Core;

public enum SessionState { Prepared, Recording, Paused, Stopped, Cancelled }
public sealed record SessionControl(string Action, DateTimeOffset AtUtc);

/// <summary>A single explicitly started session. Time budget includes paused time.</summary>
public sealed class Session
{
    public static readonly TimeSpan DurationLimit = TimeSpan.FromMinutes(20);
    private readonly object gate = new();
    private readonly TimeProvider clock;
    private readonly HashSet<string> allowedApps;
    private readonly List<CaptureEvent> events = [];
    private readonly List<SessionControl> controls = [];
    private readonly Dictionary<Guid, CaptureEvent> eventIds = [];
    private SessionState state = SessionState.Prepared;
    private long startedTimestamp;
    private DateTimeOffset? startedAtUtc;

    public Session(IEnumerable<string> allowedApps, TimeProvider? clock = null)
    {
        ArgumentNullException.ThrowIfNull(allowedApps);
        this.allowedApps = new(allowedApps, StringComparer.Ordinal);
        if (this.allowedApps.Count == 0 || this.allowedApps.Any(app => !CaptureEvent.IsSafeAppId(app)))
            throw new ArgumentException("At least one safe display app identifier is required.", nameof(allowedApps));
        this.clock = clock ?? TimeProvider.System;
    }

    public Guid Id { get; } = Guid.NewGuid();
    public SessionState State { get { lock (gate) { EnforceDeadline(); return state; } } }
    public IReadOnlyList<CaptureEvent> Events { get { lock (gate) return events.ToArray().AsReadOnly(); } }
    public IReadOnlyList<SessionControl> Controls { get { lock (gate) return controls.ToArray().AsReadOnly(); } }

    public void Start()
    {
        lock (gate)
        {
            Require(SessionState.Prepared);
            startedTimestamp = clock.GetTimestamp(); startedAtUtc = clock.GetUtcNow();
            Transition(SessionState.Recording, "start");
        }
    }
    public void Pause()
    {
        lock (gate) { EnforceDeadline(); Require(SessionState.Recording); Transition(SessionState.Paused, "pause"); }
    }
    public void Resume()
    {
        lock (gate)
        {
            Require(SessionState.Paused);
            if (Expired()) throw new InvalidOperationException("Session duration limit reached; start a new session.");
            Transition(SessionState.Recording, "resume");
        }
    }
    public void Stop()
    {
        lock (gate)
        {
            EnforceDeadline();
            if (state is not (SessionState.Recording or SessionState.Paused))
                throw new InvalidOperationException("Only an active session can stop.");
            Transition(SessionState.Stopped, "stop");
        }
    }
    public void Cancel()
    {
        lock (gate)
        {
            if (state is SessionState.Stopped or SessionState.Cancelled)
                throw new InvalidOperationException("Session is terminal.");
            Transition(SessionState.Cancelled, "cancel");
        }
    }
    public bool Append(CaptureEvent item)
    {
        ArgumentNullException.ThrowIfNull(item);
        lock (gate)
        {
            EnforceDeadline(); Require(SessionState.Recording);
            item.Validate();
            if (item.SessionId != Id || (item.AppId is not null && !allowedApps.Contains(item.AppId)))
                throw new ArgumentException("Event session or app is not allowed.", nameof(item));
            if (eventIds.TryGetValue(item.EventId, out var prior))
            {
                if (prior != item) throw new ArgumentException("Conflicting duplicate event ID.", nameof(item));
                return false;
            }
            if (item.Sequence != events.Count + 1L)
                throw new ArgumentException("Event sequence must start at one and remain contiguous.", nameof(item));
            events.Add(item); eventIds.Add(item.EventId, item);
            return true;
        }
    }

    private bool Expired() => startedAtUtc.HasValue && clock.GetElapsedTime(startedTimestamp) >= DurationLimit;
    private void EnforceDeadline()
    {
        if (state == SessionState.Recording && Expired()) Transition(SessionState.Paused, "limit_elapsed");
    }
    private void Require(SessionState expected)
    {
        if (state != expected) throw new InvalidOperationException($"Expected {expected}; actual {state}.");
    }
    private void Transition(SessionState target, string action)
    {
        state = target; controls.Add(new(action, clock.GetUtcNow()));
    }

    // Freeze all three metadata files under one lock before asynchronous IO.
    internal SessionSnapshot Snapshot()
    {
        lock (gate)
        {
            EnforceDeadline();
            return new(Id, state.ToString().ToLowerInvariant(), startedAtUtc,
                allowedApps.Order(StringComparer.Ordinal).ToArray(), events.ToArray(), controls.ToArray());
        }
    }
}

internal sealed record SessionSnapshot(Guid SessionId, string State, DateTimeOffset? StartedAtUtc,
    string[] AllowedApps, CaptureEvent[] Events, SessionControl[] Controls);
