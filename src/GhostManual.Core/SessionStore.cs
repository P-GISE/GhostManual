using System.Text;
using System.Text.Json;

namespace GhostManual.Core;

/// <summary>
/// Immutable snapshots plus an atomic same-directory pointer replacement. Unpublished snapshots
/// may remain after a crash; they are never read as current. Requires a trusted user-local root.
/// </summary>
public sealed class SessionStore
{
    private readonly string root;
    private readonly SemaphoreSlim writer = new(1, 1);
    public SessionStore(string root)
    {
        ArgumentException.ThrowIfNullOrWhiteSpace(root);
        this.root = Path.GetFullPath(root);
    }

    public async Task<string> SaveAsync(Session session, CancellationToken cancellationToken = default)
    {
        ArgumentNullException.ThrowIfNull(session);
        await writer.WaitAsync(cancellationToken);
        string? temporaryPointer = null;
        string? snapshotPath = null;
        var published = false;
        try
        {
            cancellationToken.ThrowIfCancellationRequested();
            var directory = SessionDirectory(session.Id);
            EnsurePrivateDirectory(root);
            EnsurePrivateDirectory(Path.Combine(root, "sessions"));
            EnsurePrivateDirectory(directory);
            var lockPath = Path.Combine(directory, ".write.lock");
            CheckNotLink(lockPath);
            // Competing SessionStore instances/processes fail explicitly instead of publishing stale snapshots.
            await using var fileLock = new FileStream(lockPath, FileMode.OpenOrCreate,
                FileAccess.ReadWrite, FileShare.None);
            var snapshot = session.Snapshot();
            var snapshots = Path.Combine(directory, "snapshots");
            EnsurePrivateDirectory(snapshots);
            var snapshotId = Guid.NewGuid();
            snapshotPath = Path.Combine(snapshots, snapshotId.ToString("D"));
            EnsurePrivateDirectory(snapshotPath);
            var metadata = new { schemaVersion = 1, snapshot.SessionId, snapshot.State,
                snapshot.StartedAtUtc, snapshot.AllowedApps, eventCount = snapshot.Events.Length,
                controlCount = snapshot.Controls.Length };
            await WriteNewAsync(Path.Combine(snapshotPath, "session.json"),
                JsonSerializer.Serialize(metadata, CaptureEvent.JsonOptions), cancellationToken);
            await WriteNewAsync(Path.Combine(snapshotPath, "events.jsonl"),
                string.Concat(snapshot.Events.Select(e => e.ToJson() + "\n")), cancellationToken);
            await WriteNewAsync(Path.Combine(snapshotPath, "controls.jsonl"),
                string.Concat(snapshot.Controls.Select(c => JsonSerializer.Serialize(c, CaptureEvent.JsonOptions) + "\n")), cancellationToken);
            temporaryPointer = Path.Combine(directory, $".{Guid.NewGuid():D}.tmp");
            await WriteNewAsync(temporaryPointer,
                JsonSerializer.Serialize(new { snapshotId }, CaptureEvent.JsonOptions), cancellationToken);
            cancellationToken.ThrowIfCancellationRequested();
            // Commit point: once moved, report this committed snapshot even if cancellation arrives.
            File.Move(temporaryPointer, Path.Combine(directory, "current.json"), overwrite: true);
            published = true;
            return snapshotPath;
        }
        finally
        {
            try
            {
                if (temporaryPointer is not null && File.Exists(temporaryPointer)) File.Delete(temporaryPointer);
                if (!published && snapshotPath is not null && Directory.Exists(snapshotPath)) Directory.Delete(snapshotPath, true);
            }
            finally { writer.Release(); }
        }
    }

    public async Task<string> GetCurrentSnapshotAsync(Guid sessionId, CancellationToken cancellationToken = default)
    {
        var directory = SessionDirectory(sessionId);
        CheckNotLink(root); CheckNotLink(Path.Combine(root, "sessions")); CheckNotLink(directory);
        var pointerPath = Path.Combine(directory, "current.json"); CheckNotLink(pointerPath);
        try
        {
            using var document = JsonDocument.Parse(await File.ReadAllTextAsync(pointerPath, cancellationToken));
            var properties = document.RootElement.EnumerateObject().ToArray();
            if (properties.Length != 1 || properties[0].Name != "snapshotId"
                || !Guid.TryParseExact(properties[0].Value.GetString(), "D", out var snapshotId) || snapshotId == Guid.Empty)
                throw new IOException("Invalid snapshot pointer.");
            var snapshots = Path.Combine(directory, "snapshots"); CheckNotLink(snapshots);
            var path = Path.Combine(snapshots, snapshotId.ToString("D")); CheckNotLink(path);
            foreach (var name in new[] { "session.json", "events.jsonl", "controls.jsonl" })
            {
                var file = Path.Combine(path, name); CheckNotLink(file);
                if (!File.Exists(file)) throw new IOException("Incomplete snapshot.");
            }
            return path;
        }
        catch (Exception exception) when (exception is JsonException or InvalidOperationException or FormatException)
        {
            throw new IOException("Invalid snapshot pointer.", exception);
        }
    }

    private string SessionDirectory(Guid id)
    {
        if (id == Guid.Empty) throw new ArgumentException("Session ID must not be empty.", nameof(id));
        return Path.Combine(root, "sessions", id.ToString("D"));
    }
    private static void CheckNotLink(string path)
    {
        if ((File.Exists(path) || Directory.Exists(path)) && File.GetAttributes(path).HasFlag(FileAttributes.ReparsePoint))
            throw new IOException("Linked storage paths are not supported.");
    }
    private static void EnsurePrivateDirectory(string path)
    {
        CheckNotLink(path);
        if (OperatingSystem.IsWindows()) Directory.CreateDirectory(path);
        else Directory.CreateDirectory(path, UnixFileMode.UserRead | UnixFileMode.UserWrite | UnixFileMode.UserExecute);
    }
    private static async Task WriteNewAsync(string path, string contents, CancellationToken token)
    {
        await using var stream = new FileStream(path, FileMode.CreateNew, FileAccess.Write, FileShare.None,
            4096, FileOptions.Asynchronous | FileOptions.WriteThrough);
        await stream.WriteAsync(Encoding.UTF8.GetBytes(contents), token);
        await stream.FlushAsync(token);
        stream.Flush(flushToDisk: true);
    }
}
