using System;
using System.Collections.Generic;
using System.Text.Json.Serialization;

namespace Groundwork.Engine.Models;

public sealed record RuntimeHealthEntry(
    string RuntimeId,
    string DisplayName,
    bool IsInstalled,
    string DetectedVersion,
    string StatusSummary,
    string? RecommendedWingetId);

public sealed record WindowsRepairActionInfo(
    string RepairId,
    string DisplayName,
    string Category,
    string Summary,
    string RiskNote,
    bool RequiresAdministrator,
    bool CanRunInCurrentSession);

public sealed record AppxPackageEntry(
    string Name,
    string PackageFullName,
    string Publisher,
    string Version,
    string Classification,
    string PlainDescription,
    bool IsProtectedSystemPackage,
    bool IsSuggestedBloat);

public sealed record EssentialToolEntry(
    string WingetId,
    string DisplayName,
    string Category,
    string Description,
    bool IsDetectedInstalled,
    string InstalledVersionDisplay);

public sealed record RawAppxJsonItem(
    [property: JsonPropertyName("Name")] string? Name,
    [property: JsonPropertyName("PackageFullName")] string? PackageFullName,
    [property: JsonPropertyName("Publisher")] string? Publisher,
    [property: JsonPropertyName("Version")] string? Version,
    [property: JsonPropertyName("IsFramework")] bool IsFramework,
    [property: JsonPropertyName("NonRemovable")] bool NonRemovable);
