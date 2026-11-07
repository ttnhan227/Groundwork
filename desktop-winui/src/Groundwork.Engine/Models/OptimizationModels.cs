using System;
using System.Collections.Generic;

namespace Groundwork.Engine.Models;

public sealed record PowerPlanEntry(
    string SchemeGuid,
    string Name,
    bool IsActive,
    string Description,
    string PerformanceTradeoff,
    string EnergyTradeoff)
{
    public string ActiveBadge => IsActive ? "Active" : "Available";
}

public sealed record PowerManagementSnapshot(
    IReadOnlyList<PowerPlanEntry> Plans,
    string ActiveSchemeGuid,
    string ActiveSchemeName,
    DateTimeOffset CapturedAtUtc);

public enum StartupEntryScope
{
    CurrentUserRegistry = 0,
    LocalMachineRegistry = 1,
    LocalMachineWow64Registry = 2,
    CurrentUserStartupFolder = 3,
    CommonStartupFolder = 4,
    ScheduledStartupTask = 5
}

public sealed record StartupItemEntry(
    string EntryId,
    string Name,
    string CommandOrTarget,
    string ExecutablePath,
    string Publisher,
    StartupEntryScope Scope,
    string LocationDisplay,
    bool IsEnabled,
    bool TargetExists,
    string ImpactAssessment,
    string ImpactReason,
    bool RequiresAdminToModify)
{
    public string StatusBadge => IsEnabled ? "Enabled" : "Disabled";
    public string ScopeDisplay => Scope switch
    {
        StartupEntryScope.CurrentUserRegistry => "HKCU\\...\\Run",
        StartupEntryScope.LocalMachineRegistry => "HKLM\\...\\Run",
        StartupEntryScope.LocalMachineWow64Registry => "HKLM\\WOW6432Node\\...\\Run",
        StartupEntryScope.CurrentUserStartupFolder => "User Startup Folder",
        StartupEntryScope.CommonStartupFolder => "Common Startup Folder",
        StartupEntryScope.ScheduledStartupTask => "Scheduled Logon Task",
        _ => Scope.ToString()
    };
}

public sealed record WindowsConfigurableSetting(
    string SettingId,
    string DisplayName,
    string Category,
    string CurrentStateDisplay,
    bool IsEnabled,
    string RegistryPath,
    string ValueName,
    string Explanation,
    string RecommendationNote,
    OperationReversibility Reversibility,
    OperationRiskLevel RiskLevel,
    OperationElevationRequirement ElevationRequirement)
{
    public string StateBadge => IsEnabled ? "Enabled" : "Disabled";
}
