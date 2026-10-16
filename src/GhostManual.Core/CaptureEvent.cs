using System.Text.Json;
using System.Text.Json.Serialization;
using System.Text.RegularExpressions;

namespace GhostManual.Core;

/// <summary>Only explicitly supported metadata crosses this serialization boundary.</summary>
public sealed record CaptureEvent(int SchemaVersion, Guid SessionId, Guid EventId,
    long Sequence, DateTimeOffset ObservedAtUtc, string Kind, string? AppId = null, string? SafeNote = null)
{
    internal static readonly JsonSerializerOptions JsonOptions = new(JsonSerializerDefaults.Web)
    {
        PropertyNameCaseInsensitive = false,
        UnmappedMemberHandling = JsonUnmappedMemberHandling.Disallow
    };
    private static readonly HashSet<string> RequiredFields =
        ["schemaVersion", "sessionId", "eventId", "sequence", "observedAtUtc", "kind"];

    internal static bool IsSafeAppId(string? value) => value is not null
        && Regex.IsMatch(value, @"\A[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}\z", RegexOptions.CultureInvariant);

    internal void Validate()
    {
        if (SchemaVersion != 1 || SessionId == Guid.Empty || EventId == Guid.Empty || Sequence < 1
            || ObservedAtUtc == default || ObservedAtUtc.Offset != TimeSpan.Zero
            || Kind is not ("app_focus" or "gap" or "annotation" or "evidence_request")
            || (AppId is not null && !IsSafeAppId(AppId))
            || (Kind is "app_focus" or "evidence_request" && AppId is null)
            || SafeNote?.Length > 1000)
            throw new ArgumentException("Invalid capture event v1 contract.");
    }

    public static CaptureEvent Parse(string json)
    {
        ArgumentNullException.ThrowIfNull(json);
        try
        {
            using var document = JsonDocument.Parse(json);
            if (document.RootElement.ValueKind != JsonValueKind.Object)
                throw new ArgumentException("Event must be a JSON object.");
            var names = new HashSet<string>(StringComparer.Ordinal);
            foreach (var property in document.RootElement.EnumerateObject())
                if (!names.Add(property.Name)) throw new ArgumentException("Duplicate event field.");
            if (!RequiredFields.IsSubsetOf(names)) throw new ArgumentException("Missing required event field.");
            var item = JsonSerializer.Deserialize<CaptureEvent>(json, JsonOptions)
                ?? throw new ArgumentException("Missing capture event.");
            item.Validate();
            return item;
        }
        catch (JsonException exception)
        {
            throw new ArgumentException("Invalid capture event JSON.", nameof(json), exception);
        }
    }

    public string ToJson()
    {
        Validate();
        return JsonSerializer.Serialize(this, JsonOptions);
    }
}
