using System.Text.Json;
using GhostManual.Core;
using Xunit;

namespace GhostManual.Core.Tests;

public sealed class SessionTests
{
    private sealed class Clock : TimeProvider
    {
        public DateTimeOffset Now = new(2026, 10, 16, 0, 0, 0, TimeSpan.Zero);
        public override DateTimeOffset GetUtcNow() => Now;
        public override long GetTimestamp() => Now.UtcTicks;
        public override long TimestampFrequency => TimeSpan.TicksPerSecond;
    }
    private static CaptureEvent Event(Session s, long sequence = 1, string? app = "excel", string? note = null)
        => new(1, s.Id, Guid.NewGuid(), sequence, new(2026, 10, 16, 0, 0, 1, TimeSpan.Zero), "app_focus", app, note);

    [Fact] public void FullLifecycleRecordsControls()
    {
        var s = new Session(["excel"]);
        Assert.Equal(SessionState.Prepared, s.State);
        s.Start(); s.Pause(); s.Resume(); s.Stop();
        Assert.Equal(SessionState.Stopped, s.State);
        Assert.Equal(new[] { "start", "pause", "resume", "stop" }, s.Controls.Select(c => c.Action));
        Assert.Throws<InvalidOperationException>(s.Resume);
        Assert.Throws<InvalidOperationException>(s.Start);
    }
    [Fact] public void InvalidTransitionsCannotStartOrResumeRecording()
    {
        var s = new Session(["excel"]);
        Assert.Throws<InvalidOperationException>(s.Resume);
        Assert.Throws<InvalidOperationException>(s.Pause);
        s.Start(); Assert.Throws<InvalidOperationException>(s.Start);
        s.Cancel(); Assert.Equal(SessionState.Cancelled, s.State);
        Assert.Throws<InvalidOperationException>(s.Resume);
        Assert.Throws<InvalidOperationException>(s.Cancel);
    }
    [Fact] public void CancelPreparedSessionIsTerminal()
    {
        var s = new Session(["excel"]); s.Cancel();
        Assert.Equal(SessionState.Cancelled, s.State);
        Assert.Throws<InvalidOperationException>(s.Start);
    }
    [Fact] public void TwentyMinuteLimitIncludesPausedTime()
    {
        var clock = new Clock(); var s = new Session(["excel"], clock);
        s.Start(); clock.Now += TimeSpan.FromMinutes(1); s.Pause();
        clock.Now += TimeSpan.FromMinutes(19);
        Assert.Throws<InvalidOperationException>(s.Resume);
        Assert.Equal(SessionState.Paused, s.State);
    }
    [Fact] public void ExpiredRecordingPausesBeforeAcceptingEvent()
    {
        var clock = new Clock(); var s = new Session(["excel"], clock); s.Start();
        clock.Now += TimeSpan.FromMinutes(20);
        Assert.Throws<InvalidOperationException>(() => s.Append(Event(s)));
        Assert.Equal(SessionState.Paused, s.State); Assert.Empty(s.Events);
        Assert.Equal("limit_elapsed", s.Controls.Last().Action);
    }
    [Fact] public void InvalidAppsAreRejectedWithoutConsumingSequence()
    {
        var s = new Session(["excel"]); s.Start();
        foreach (var app in new[] { "other", "/private/excel", "EXCEL" })
            Assert.Throws<ArgumentException>(() => s.Append(Event(s, app: app)));
        Assert.True(s.Append(Event(s))); Assert.Single(s.Events);
    }
    [Fact] public void DuplicateIsIgnoredButOtherSequenceReplaysAreRejected()
    {
        var s = new Session(["excel"]); s.Start(); var e = Event(s);
        Assert.True(s.Append(e)); Assert.False(s.Append(e));
        Assert.Throws<ArgumentException>(() => s.Append(Event(s)));
        Assert.Throws<ArgumentException>(() => s.Append(Event(s, 3)));
        Assert.True(s.Append(Event(s, 2))); Assert.Equal(2, s.Events.Count);
    }
    [Theory] [InlineData("prepared")] [InlineData("paused")] [InlineData("stopped")] [InlineData("cancelled")]
    public void EventsAreAcceptedOnlyWhileRecording(string state)
    {
        var s = new Session(["excel"]);
        if (state != "prepared") s.Start();
        if (state == "paused") s.Pause();
        if (state == "stopped") s.Stop();
        if (state == "cancelled") s.Cancel();
        Assert.Throws<InvalidOperationException>(() => s.Append(Event(s)));
    }
    [Theory] [InlineData(1000, true)] [InlineData(1001, false)]
    public void SafeNoteUsesUtf16Boundary(int length, bool valid)
    {
        var s = new Session(["excel"]); s.Start(); var e = Event(s, note: new string('가', length));
        if (valid) Assert.True(s.Append(e));
        else Assert.Throws<ArgumentException>(() => s.Append(e));
    }
    [Fact] public void EmojiCountsAsTwoUtf16Units()
    {
        var s = new Session(["excel"]); s.Start();
        Assert.Throws<ArgumentException>(() => s.Append(Event(s, note: string.Concat(Enumerable.Repeat("😀", 501)))));
    }
    [Theory] [InlineData("version")] [InlineData("session")] [InlineData("event")] [InlineData("sequence")] [InlineData("time")] [InlineData("kind")] [InlineData("focus_without_app")]
    public void InvalidEventContractsAreRejected(string field)
    {
        var s = new Session(["excel"]); s.Start(); var e = Event(s);
        e = field switch {
            "version" => e with { SchemaVersion = 2 }, "session" => e with { SessionId = Guid.NewGuid() },
            "event" => e with { EventId = Guid.Empty }, "sequence" => e with { Sequence = 0 },
            "time" => e with { ObservedAtUtc = e.ObservedAtUtc.ToOffset(TimeSpan.FromHours(9)) },
            "kind" => e with { Kind = "keystroke" }, _ => e with { AppId = null }
        };
        Assert.Throws<ArgumentException>(() => s.Append(e)); Assert.Empty(s.Events);
    }
    [Fact] public void JsonContainsOnlyWhitelistedFieldsAndRoundTrips()
    {
        var s = new Session(["excel"]); var e = Event(s, note: "검토 필요");
        var json = e.ToJson(); using var doc = JsonDocument.Parse(json);
        Assert.Equal(new[] { "appId", "eventId", "kind", "observedAtUtc", "safeNote", "schemaVersion", "sequence", "sessionId" },
            doc.RootElement.EnumerateObject().Select(p => p.Name).Order());
        Assert.Equal(e, CaptureEvent.Parse(json));
    }
    [Theory] [InlineData("unknown")] [InlineData("version")] [InlineData("missing")] [InlineData("duplicate")]
    public void JsonReaderRejectsUnknownMissingDuplicateAndUnsupportedData(string mutation)
    {
        var json = JsonSerializer.SerializeToNode(Event(new Session(["excel"])), new JsonSerializerOptions(JsonSerializerDefaults.Web))!.AsObject();
        if (mutation == "unknown") json["windowTitle"] = "private";
        if (mutation == "version") json["schemaVersion"] = 2;
        if (mutation == "missing") json.Remove("eventId");
        var text = json.ToJsonString();
        if (mutation == "duplicate") text = text.Insert(1, "\"schemaVersion\":1,");
        Assert.ThrowsAny<ArgumentException>(() => CaptureEvent.Parse(text));
    }
    [Fact] public void ExposedCollectionsCannotMutateSession()
    {
        var s = new Session(["excel"]); s.Start(); s.Append(Event(s));
        Assert.False(s.Events is List<CaptureEvent>);
        Assert.Throws<NotSupportedException>(() => ((IList<CaptureEvent>)s.Events).Clear());
    }
}
