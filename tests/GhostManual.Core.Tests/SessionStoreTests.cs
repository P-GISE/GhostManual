using System.Text.Json;
using GhostManual.Core;
using Xunit;

namespace GhostManual.Core.Tests;

public sealed class SessionStoreTests : IDisposable
{
    private readonly string root = Path.Combine(Path.GetTempPath(), "ghostmanual-tests-" + Guid.NewGuid());
    public void Dispose() { if (Directory.Exists(root)) Directory.Delete(root, true); }
    [Fact] public async Task SavesConsistentSnapshotAndPublishesPointer()
    {
        var s = new Session(["excel"]); s.Start();
        s.Append(new(1, s.Id, Guid.NewGuid(), 1, DateTimeOffset.UtcNow, "annotation", "excel", "확인 필요"));
        var store = new SessionStore(root); var first = await store.SaveAsync(s);
        Assert.Equal(first, await store.GetCurrentSnapshotAsync(s.Id));
        Assert.Equal(s.Id.ToString("D"), Directory.GetParent(Path.GetDirectoryName(first)!)!.Name);
        Assert.Single(await File.ReadAllLinesAsync(Path.Combine(first, "events.jsonl")));
        using var metadata = JsonDocument.Parse(await File.ReadAllTextAsync(Path.Combine(first, "session.json")));
        Assert.Equal(s.Id, metadata.RootElement.GetProperty("sessionId").GetGuid());
        Assert.Single(await File.ReadAllLinesAsync(Path.Combine(first, "controls.jsonl")));
        s.Stop(); var second = await store.SaveAsync(s);
        Assert.NotEqual(first, second); Assert.Equal(second, await store.GetCurrentSnapshotAsync(s.Id));
        Assert.Equal(2, (await File.ReadAllLinesAsync(Path.Combine(second, "controls.jsonl"))).Length);
        Assert.Single(await File.ReadAllLinesAsync(Path.Combine(first, "controls.jsonl")));
    }
    [Fact] public async Task WriteFailureCannotPublishSuccess()
    {
        Directory.CreateDirectory(root); var file = Path.Combine(root, "not-a-directory"); await File.WriteAllTextAsync(file, "blocked");
        await Assert.ThrowsAnyAsync<IOException>(() => new SessionStore(file).SaveAsync(new Session(["excel"])));
        Assert.Equal("blocked", await File.ReadAllTextAsync(file));
    }
    [Fact] public async Task CancelledSaveKeepsPreviouslyCommittedSnapshot()
    {
        var store = new SessionStore(root); var s = new Session(["excel"]); var original = await store.SaveAsync(s);
        using var cts = new CancellationTokenSource(); cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(() => store.SaveAsync(s, cts.Token));
        Assert.Equal(original, await store.GetCurrentSnapshotAsync(s.Id));
    }
    [Fact] public async Task ConcurrentWriterLockRejectsSecondStoreWithoutChangingPointer()
    {
        var s = new Session(["excel"]); var store = new SessionStore(root);
        var first = await store.SaveAsync(s);
        var directory = Directory.GetParent(Path.GetDirectoryName(first)!)!.FullName;
        using (var held = new FileStream(Path.Combine(directory, ".write.lock"), FileMode.OpenOrCreate, FileAccess.ReadWrite, FileShare.None))
        {
            await Assert.ThrowsAnyAsync<IOException>(() => new SessionStore(root).SaveAsync(s));
            Assert.Equal(first, await store.GetCurrentSnapshotAsync(s.Id));
        }
        Assert.NotEqual(first, await store.SaveAsync(s));
    }
    [Fact] public async Task FailedPointerPublicationCleansSnapshotAndAllowsRetry()
    {
        var s = new Session(["excel"]); var store = new SessionStore(root);
        var first = await store.SaveAsync(s);
        var directory = Directory.GetParent(Path.GetDirectoryName(first)!)!.FullName;
        var pointer = Path.Combine(directory, "current.json");
        File.Delete(pointer); Directory.CreateDirectory(pointer);
        await Assert.ThrowsAnyAsync<IOException>(() => store.SaveAsync(s));
        Assert.Single(Directory.GetDirectories(Path.Combine(directory, "snapshots")));
        Assert.Empty(Directory.GetFiles(directory, "*.tmp"));
        Directory.Delete(pointer);
        var recovered = await store.SaveAsync(s);
        Assert.Equal(recovered, await store.GetCurrentSnapshotAsync(s.Id));
    }
    [Fact] public async Task CorruptPointerCannotEscapeStorageRoot()
    {
        var store = new SessionStore(root); var s = new Session(["excel"]); var snapshot = await store.SaveAsync(s);
        var pointer = Path.Combine(Directory.GetParent(Path.GetDirectoryName(snapshot)!)!.FullName, "current.json");
        await File.WriteAllTextAsync(pointer, "{\"snapshotId\":\"../../private\"}");
        await Assert.ThrowsAnyAsync<IOException>(() => store.GetCurrentSnapshotAsync(s.Id));
    }
}
