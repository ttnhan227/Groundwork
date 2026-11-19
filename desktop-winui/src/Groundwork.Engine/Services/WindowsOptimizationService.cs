using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using System.Xml.Linq;
using Groundwork.Engine.Models;
using Microsoft.Win32;

namespace Groundwork.Engine.Services;

/// <summary>
/// Provides inspection and reversible configuration of Windows Power Plans, Startup Entries,
/// and Windows Performance / Gaming / Privacy settings through <see cref="SafeOperationEngine"/>.
/// </summary>
public sealed class WindowsOptimizationService
{
    public const string PowerSwitchOperationId = "power.switch_plan";
    public const string PowerUnlockUltimateOperationId = "power.unlock_ultimate";
    public const string HibernateToggleOperationId = "power.toggle_hibernation";
    public const string StartupToggleOperationId = "startup.toggle_item";
    public const string SettingToggleOperationId = "settings.toggle_user_setting";
    public const string TweakPresetOperationId = "settings.apply_preset";
    private const string UltimatePerformanceSourceGuid = "e9a42b02-d5df-448d-aa00-03f14749eb61";

    public static IReadOnlyDictionary<string, bool> CleanWindows11Preset { get; } = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
    {
        ["customization.classic_context_menu"] = true,
        ["customization.taskbar_end_task"] = true,
        ["customization.show_file_extensions"] = true,
        ["debloat.disable_bing_search"] = true,
        ["debloat.disable_start_ads"] = true,
        ["debloat.hide_widgets"] = true,
        ["debloat.hide_copilot_button"] = true,
        ["privacy.advertising_id"] = false,
        ["privacy.tailored_experiences"] = false
    };

    public static IReadOnlyDictionary<string, bool> GamingLatencyPreset { get; } = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase)
    {
        ["gaming.game_mode"] = true,
        ["gaming.game_dvr"] = false,
        ["performance.background_apps"] = false,
        ["customization.disable_mouse_accel"] = true
    };

    private const string HkcuRunSubKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string HklmRunSubKey = @"Software\Microsoft\Windows\CurrentVersion\Run";
    private const string HklmWow64RunSubKey = @"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run";
    private const string HkcuStartupApprovedRunSubKey = @"Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved\Run";
    private const string HkcuGroundworkDisabledRunSubKey = @"Software\Groundwork\DisabledStartupRun";

    private static readonly Regex PowerGuidRegex = new(
        @"([0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})\s*\(([^)]+)\)(\s*\*)?",
        RegexOptions.Compiled);

    private readonly SafeOperationEngine _safeOperationEngine;
    private readonly string? _customUserStartupDir;
    private readonly string? _customDisabledStartupDir;
    private readonly string _hkcuSettingsPrefix;
    private readonly Func<IReadOnlyList<string>, string> _powerCfgRunner;

    private sealed record PowerSwitchPayload(string TargetSchemeGuid, string TargetSchemeName, string PreviousSchemeGuid, string PreviousSchemeName);
    private sealed record UnlockUltimatePayload(string PreviousSchemeGuid, string PreviousSchemeName, string? CreatedSchemeGuid);
    private sealed record StartupTogglePayload(string EntryId, string Name, StartupEntryScope Scope, string CommandOrTarget, bool TargetEnabled, string DisabledBackupPath);
    private sealed record SettingTogglePayload(
        string SettingId,
        string DisplayName,
        bool TargetEnabled,
        int? PreviousDwordValue,
        bool? PreviousSubKeyExisted = null,
        IReadOnlyDictionary<string, int?>? PreviousCompanionDwords = null,
        IReadOnlyDictionary<string, string?>? PreviousStrings = null);
    private sealed record TweakPresetPayload(string PresetName, IReadOnlyList<SettingTogglePayload> Items);
    private sealed record HibernateTogglePayload(bool TargetEnabled, bool PreviousEnabled);

    public WindowsOptimizationService(
        SafeOperationEngine? safeOperationEngine = null,
        string? customUserStartupDir = null,
        string? customDisabledStartupDir = null,
        string? customHkcuSettingsPrefix = null,
        Func<IReadOnlyList<string>, string>? customPowerCfgRunner = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _customUserStartupDir = customUserStartupDir;
        _customDisabledStartupDir = customDisabledStartupDir;
        _hkcuSettingsPrefix = string.IsNullOrWhiteSpace(customHkcuSettingsPrefix)
            ? string.Empty
            : customHkcuSettingsPrefix.Trim().Trim('\\') + "\\";
        _powerCfgRunner = customPowerCfgRunner ?? DefaultRunPowerCfg;

        RegisterOperationHandlers();
    }

    public SafeOperationEngine SafeOperations => _safeOperationEngine;

    public static SystemOperationDescriptor PowerSwitchDescriptor { get; } = new(
        OperationTypeId: PowerSwitchOperationId,
        DisplayName: "Switch Active Windows Power Plan",
        Category: "Optimize / Power Management",
        Description: "Switches the active Windows power scheme using powercfg and captures the previous scheme for one-click restoration.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "High Performance or Ultimate Performance plans increase idle CPU clock speeds and energy consumption.",
            "Power Saver reduces CPU boost frequencies and may lower frame rates or responsiveness."
        ],
        VerificationMethodDescription: "Queries powercfg /getactivescheme to confirm the target scheme GUID is active.",
        RollbackMethodDescription: "Restores the previously active power scheme GUID via powercfg /setactive.");

    public static SystemOperationDescriptor UnlockUltimatePerformanceDescriptor { get; } = new(
        OperationTypeId: PowerUnlockUltimateOperationId,
        DisplayName: "Unlock & Activate Ultimate Performance Power Plan",
        Category: "Optimize / Power Management",
        Description: "Unhides Windows' hidden Ultimate Performance workstation scheme via powercfg /duplicatescheme and activates it.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Eliminates micro-latency power saving states, increasing idle electricity draw and fan speed.",
            "Note: Laptops locked to Modern Standby (S0 Low Power Idle) firmware may restrict non-Balanced power schemes."
        ],
        VerificationMethodDescription: "Verifies Ultimate Performance appears in powercfg /list and is set as active.",
        RollbackMethodDescription: "Switches back to your previous power plan.");

    public static SystemOperationDescriptor StartupToggleDescriptor { get; } = new(
        OperationTypeId: StartupToggleOperationId,
        DisplayName: "Toggle Windows Startup Entry",
        Category: "Optimize / Startup Management",
        Description: "Enables or disables a user startup item while preserving the original command or shortcut for full recovery.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Disabling a startup helper may prevent background notifications, cloud folder syncing, or peripheral hotkeys from starting automatically at sign-in.",
            "The application can still be launched manually at any time."
        ],
        VerificationMethodDescription: "Re-inspects the startup registry key or startup folder to confirm the entry state matches the requested toggle.",
        RollbackMethodDescription: "Restores the startup registry value or shortcut to its previous enabled/disabled state.");

    public static SystemOperationDescriptor SettingToggleDescriptor { get; } = new(
        OperationTypeId: SettingToggleOperationId,
        DisplayName: "Configure Windows Performance / Privacy / UI Setting",
        Category: "Optimize / Windows Configuration",
        Description: "Updates a user-scoped Windows configuration value in HKCU and records the previous value for rollback.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Explorer or taskbar tweaks may require restarting File Explorer (one click in Groundwork) to show immediately."
        ],
        VerificationMethodDescription: "Reads back the registry key/value in HKCU to verify it matches the target configuration.",
        RollbackMethodDescription: "Restores the captured pre-change DWORD value or key state.");

    public static SystemOperationDescriptor TweakPresetDescriptor { get; } = new(
        OperationTypeId: TweakPresetOperationId,
        DisplayName: "Apply Windows Power Tweak Preset",
        Category: "Optimize / Windows Configuration",
        Description: "Applies a curated set of user-scoped Windows tweaks in a single operation and records pre-change values for one-click rollback.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Modifies multiple HKCU Explorer, taskbar, privacy, or mouse settings together.",
            "Click 'Restart File Explorer' afterward to make shell and context-menu updates visible immediately."
        ],
        VerificationMethodDescription: "Re-inspects every included setting ID in HKCU to confirm all targets match the preset.",
        RollbackMethodDescription: "Restores every modified setting in the preset back to its exact pre-preset value.");

    public static SystemOperationDescriptor HibernateToggleDescriptor { get; } = new(
        OperationTypeId: HibernateToggleOperationId,
        DisplayName: "Toggle Windows Hibernation (hiberfil.sys)",
        Category: "Optimize / Power & Storage",
        Description: "Enables or disables Windows Hibernation via powercfg /hibernate to reclaim several gigabytes of SSD space on desktops or always-plugged systems.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Medium,
        ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
        PotentialRisks:
        [
            "Requires Administrator privileges.",
            "Disabling Hibernation also disables Windows Fast Startup and Hibernate sleep mode, while removing C:\\hiberfil.sys."
        ],
        VerificationMethodDescription: "Queries HKLM HibernateEnabled state after running powercfg /hibernate.",
        RollbackMethodDescription: "Re-enables or disables hibernation back to its previous state via powercfg /hibernate.");

    private void RegisterOperationHandlers()
    {
        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: PowerSwitchDescriptor,
            ExecuteAsync: ExecutePowerSwitchPayloadAsync,
            RollbackAsync: RollbackPowerSwitchPayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: UnlockUltimatePerformanceDescriptor,
            ExecuteAsync: ExecuteUnlockUltimatePayloadAsync,
            RollbackAsync: RollbackUnlockUltimatePayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: HibernateToggleDescriptor,
            ExecuteAsync: ExecuteHibernateToggleAsync,
            RollbackAsync: RollbackHibernateToggleAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: StartupToggleDescriptor,
            ExecuteAsync: ExecuteStartupTogglePayloadAsync,
            RollbackAsync: RollbackStartupTogglePayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: SettingToggleDescriptor,
            ExecuteAsync: ExecuteSettingTogglePayloadAsync,
            RollbackAsync: RollbackSettingTogglePayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: TweakPresetDescriptor,
            ExecuteAsync: ExecuteTweakPresetAsync,
            RollbackAsync: RollbackTweakPresetAsync));
    }

    // =========================================================================
    // 1. POWER MANAGEMENT
    // =========================================================================

    public PowerManagementSnapshot InspectPowerPlans()
    {
        var output = RunPowerCfg(["/list"]);
        var plans = ParsePowerCfgListOutput(output);

        if (plans.Count == 0)
        {
            var activeOut = RunPowerCfg(["/getactivescheme"]);
            plans = ParsePowerCfgListOutput(activeOut);
        }

        var active = plans.FirstOrDefault(p => p.IsActive) ?? plans.FirstOrDefault();
        return new PowerManagementSnapshot(
            Plans: plans,
            ActiveSchemeGuid: active?.SchemeGuid ?? string.Empty,
            ActiveSchemeName: active?.Name ?? "Unknown Power Scheme",
            CapturedAtUtc: DateTimeOffset.UtcNow);
    }

    public static IReadOnlyList<PowerPlanEntry> ParsePowerCfgListOutput(string? rawOutput)
    {
        if (string.IsNullOrWhiteSpace(rawOutput))
        {
            return [];
        }

        var results = new List<PowerPlanEntry>();
        var lines = rawOutput.Split(['\r', '\n'], StringSplitOptions.RemoveEmptyEntries);
        foreach (var line in lines)
        {
            var match = PowerGuidRegex.Match(line);
            if (!match.Success)
            {
                continue;
            }

            var guid = match.Groups[1].Value.Trim();
            var name = match.Groups[2].Value.Trim();
            var isActive = !string.IsNullOrWhiteSpace(match.Groups[3].Value) || line.TrimEnd().EndsWith('*');

            var (desc, perf, energy) = DescribePowerPlan(guid, name);
            results.Add(new PowerPlanEntry(
                SchemeGuid: guid,
                Name: name,
                IsActive: isActive,
                Description: desc,
                PerformanceTradeoff: perf,
                EnergyTradeoff: energy));
        }

        return results;
    }

    public static (string Description, string PerformanceTradeoff, string EnergyTradeoff) DescribePowerPlan(string guid, string name)
    {
        var normName = (name ?? string.Empty).ToLowerInvariant();
        var normGuid = (guid ?? string.Empty).ToLowerInvariant();

        if (normGuid == "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c" || normName.Contains("high performance") || normName.Contains("ultimate"))
        {
            return (
                "Keeps processor minimum states elevated and reduces PCIe/USB selective suspend for maximum responsiveness.",
                "Minimizes CPU frequency ramp-up latency during heavy workloads or gaming.",
                "Higher idle power draw, increased heat output, and shorter battery runtime on laptops.");
        }

        if (normGuid == "a1841308-3541-4fab-bc81-f71556f20b4a" || normName.Contains("power saver") || normName.Contains("eco"))
        {
            return (
                "Prioritizes energy conservation by capping processor boost states and aggressively parking idle cores.",
                "May reduce responsiveness during compiling, multitasking, or gaming.",
                "Maximizes battery life and reduces system heat and fan noise.");
        }

        return (
            "Automatically scales processor frequency and hardware power states based on active workload demand.",
            "Full boost performance under load while allowing deep idle C-states when idle.",
            "Recommended balance of responsiveness and energy efficiency for most Windows desktops and laptops.");
    }

    public OperationProposal ProposeSwitchPowerPlan(string targetSchemeGuid)
    {
        var snapshot = InspectPowerPlans();
        var target = snapshot.Plans.FirstOrDefault(p =>
            string.Equals(p.SchemeGuid, targetSchemeGuid, StringComparison.OrdinalIgnoreCase));

        var previousGuid = snapshot.ActiveSchemeGuid;
        var previousName = snapshot.ActiveSchemeName;

        var payload = new PowerSwitchPayload(
            TargetSchemeGuid: target?.SchemeGuid ?? targetSchemeGuid,
            TargetSchemeName: target?.Name ?? targetSchemeGuid,
            PreviousSchemeGuid: previousGuid,
            PreviousSchemeName: previousName);

        var payloadJson = JsonSerializer.Serialize(payload);

        return _safeOperationEngine.CreateProposal(
            descriptor: PowerSwitchDescriptor,
            targetDescription: $"Power Plan: {target?.Name ?? targetSchemeGuid} ({targetSchemeGuid})",
            inspectedCurrentStateSummary: $"Currently active power plan: {previousName} ({previousGuid})",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Switch active Windows power plan from '{previousName}' to '{target?.Name ?? targetSchemeGuid}'. {target?.Description}",
            expectedEffects:
            [
                target?.PerformanceTradeoff ?? "Updates processor and device power management policy.",
                target?.EnergyTradeoff ?? "Modifies idle energy consumption behavior."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (string.IsNullOrWhiteSpace(targetSchemeGuid) || !Guid.TryParse(targetSchemeGuid, out _))
                {
                    return (false, $"'{targetSchemeGuid}' is not a valid Windows Power Scheme GUID.");
                }
                if (target is null && snapshot.Plans.Count > 0)
                {
                    return (false, $"Power scheme '{targetSchemeGuid}' was not found on this machine.");
                }
                return (true, "Valid power scheme GUID.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecutePowerSwitchPayloadAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<PowerSwitchPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid power switch payload.");

        RunPowerCfg(["/setactive", payload.TargetSchemeGuid]);
        var after = InspectPowerPlans();
        var verified = string.Equals(after.ActiveSchemeGuid, payload.TargetSchemeGuid, StringComparison.OrdinalIgnoreCase);

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: $"Active scheme is now {after.ActiveSchemeName} ({after.ActiveSchemeGuid})",
            VerificationDetails: verified
                ? $"Verified via powercfg that '{payload.TargetSchemeName}' ({payload.TargetSchemeGuid}) is active."
                : $"Expected active scheme '{payload.TargetSchemeGuid}', but observed '{after.ActiveSchemeGuid}'.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: verified
                ? $"Switched active power plan to '{payload.TargetSchemeName}'."
                : $"Failed to verify power plan switch to '{payload.TargetSchemeName}'.",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackPowerSwitchPayloadAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<PowerSwitchPayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid power switch rollback state.");

        if (string.IsNullOrWhiteSpace(payload.PreviousSchemeGuid))
        {
            return Task.FromResult((
                Succeeded: false,
                StatusMessage: "No previous power scheme GUID was captured.",
                Verification: new OperationVerificationResult(false, "Missing previous GUID", "Cannot restore.", DateTimeOffset.UtcNow)));
        }

        RunPowerCfg(["/setactive", payload.PreviousSchemeGuid]);
        var after = InspectPowerPlans();
        var verified = string.Equals(after.ActiveSchemeGuid, payload.PreviousSchemeGuid, StringComparison.OrdinalIgnoreCase);

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: $"Active scheme after rollback: {after.ActiveSchemeName} ({after.ActiveSchemeGuid})",
            VerificationDetails: verified
                ? $"Restored previous power scheme '{payload.PreviousSchemeName}' ({payload.PreviousSchemeGuid})."
                : $"Expected '{payload.PreviousSchemeGuid}', observed '{after.ActiveSchemeGuid}'.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            StatusMessage: verified
                ? $"Restored power plan to '{payload.PreviousSchemeName}'."
                : "Could not verify power plan rollback.",
            Verification: verification));
    }

    public OperationProposal ProposeUnlockUltimatePerformancePlan()
    {
        var snapshot = InspectPowerPlans();
        var existingUltimate = snapshot.Plans.FirstOrDefault(p =>
            p.Name.Contains("Ultimate Performance", StringComparison.OrdinalIgnoreCase));

        var payload = new UnlockUltimatePayload(
            PreviousSchemeGuid: snapshot.ActiveSchemeGuid,
            PreviousSchemeName: snapshot.ActiveSchemeName,
            CreatedSchemeGuid: existingUltimate?.SchemeGuid);
        var payloadJson = JsonSerializer.Serialize(payload);

        return _safeOperationEngine.CreateProposal(
            descriptor: UnlockUltimatePerformanceDescriptor,
            targetDescription: "Power Plan: Ultimate Performance",
            inspectedCurrentStateSummary: existingUltimate is not null
                ? $"Ultimate Performance already exists ({existingUltimate.SchemeGuid}); active plan is '{snapshot.ActiveSchemeName}'."
                : $"Ultimate Performance is currently hidden; active plan is '{snapshot.ActiveSchemeName}'.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: existingUltimate is not null
                ? $"Activates existing Ultimate Performance plan ({existingUltimate.SchemeGuid})."
                : $"Unhides Windows' Ultimate Performance scheme via 'powercfg /duplicatescheme {UltimatePerformanceSourceGuid}' and activates it.",
            expectedEffects:
            [
                "Minimizes CPU latency and prevents idle frequency throttling on plugged-in desktops/workstations.",
                "Higher idle power consumption; you can switch back to Balanced at any time."
            ],
            payloadJson: payloadJson);
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteUnlockUltimatePayloadAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<UnlockUltimatePayload>(payloadJson)
            ?? new UnlockUltimatePayload(string.Empty, string.Empty, null);

        var targetGuid = payload.CreatedSchemeGuid;
        if (string.IsNullOrWhiteSpace(targetGuid))
        {
            var dupOutput = RunPowerCfg(["/duplicatescheme", UltimatePerformanceSourceGuid]);
            var match = PowerGuidRegex.Match(dupOutput);
            if (match.Success)
            {
                targetGuid = match.Groups[1].Value.Trim();
            }
            else
            {
                var afterDup = InspectPowerPlans();
                targetGuid = afterDup.Plans
                    .FirstOrDefault(p => p.Name.Contains("Ultimate Performance", StringComparison.OrdinalIgnoreCase))
                    ?.SchemeGuid;
            }
        }

        if (!string.IsNullOrWhiteSpace(targetGuid))
        {
            RunPowerCfg(["/setactive", targetGuid]);
        }

        var after = InspectPowerPlans();
        var ultimate = after.Plans.FirstOrDefault(p =>
            p.Name.Contains("Ultimate Performance", StringComparison.OrdinalIgnoreCase) ||
            (!string.IsNullOrWhiteSpace(targetGuid) && string.Equals(p.SchemeGuid, targetGuid, StringComparison.OrdinalIgnoreCase)));
        var verified = ultimate is not null && string.Equals(after.ActiveSchemeGuid, ultimate.SchemeGuid, StringComparison.OrdinalIgnoreCase);

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: $"Active scheme is {after.ActiveSchemeName} ({after.ActiveSchemeGuid})",
            VerificationDetails: verified
                ? $"Ultimate Performance ({ultimate!.SchemeGuid}) unlocked and active."
                : "Windows firmware (e.g., Modern Standby S0) or policy did not permit activating a custom Ultimate Performance scheme.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: verified
                ? "Unlocked and activated Ultimate Performance power plan."
                : "Could not unlock/activate Ultimate Performance on this hardware (Balanced mode is hardware-managed).",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackUnlockUltimatePayloadAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<UnlockUltimatePayload>(preChangeStateJson);
        if (payload is null || string.IsNullOrWhiteSpace(payload.PreviousSchemeGuid))
        {
            return Task.FromResult((
                Succeeded: false,
                StatusMessage: "No previous power scheme GUID was recorded.",
                Verification: new OperationVerificationResult(false, "Unknown", "Missing prior power scheme GUID.", DateTimeOffset.UtcNow)));
        }

        RunPowerCfg(["/setactive", payload.PreviousSchemeGuid]);

        // If Ultimate Performance did not exist before Groundwork created it, remove the duplicated scheme.
        if (string.IsNullOrWhiteSpace(payload.CreatedSchemeGuid))
        {
            var currentPlans = InspectPowerPlans().Plans;
            foreach (var dup in currentPlans.Where(p =>
                         p.Name.Contains("Ultimate Performance", StringComparison.OrdinalIgnoreCase) &&
                         !string.Equals(p.SchemeGuid, payload.PreviousSchemeGuid, StringComparison.OrdinalIgnoreCase)))
            {
                RunPowerCfg(["/delete", dup.SchemeGuid]);
            }
        }

        var after = InspectPowerPlans();
        var verified = string.Equals(after.ActiveSchemeGuid, payload.PreviousSchemeGuid, StringComparison.OrdinalIgnoreCase);
        return Task.FromResult((
            Succeeded: verified,
            StatusMessage: verified
                ? $"Restored previous power plan '{payload.PreviousSchemeName}'."
                : $"Power plan rollback did not verify active GUID '{payload.PreviousSchemeGuid}'.",
            Verification: new OperationVerificationResult(
                verified,
                after.ActiveSchemeName,
                verified ? "Previous power scheme restored." : "Active power scheme mismatch.",
                DateTimeOffset.UtcNow)));
    }

    private string RunPowerCfg(IReadOnlyList<string> args) => _powerCfgRunner(args);

    private static string DefaultRunPowerCfg(IReadOnlyList<string> args)
    {
        if (!OperatingSystem.IsWindows())
        {
            return string.Empty;
        }

        try
        {
            var psi = new ProcessStartInfo
            {
                FileName = "powercfg.exe",
                UseShellExecute = false,
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                CreateNoWindow = true
            };
            foreach (var arg in args)
            {
                psi.ArgumentList.Add(arg);
            }

            using var proc = Process.Start(psi);
            if (proc is null)
            {
                return string.Empty;
            }

            var output = proc.StandardOutput.ReadToEnd();
            proc.WaitForExit(4000);
            return output;
        }
        catch
        {
            return string.Empty;
        }
    }

    // =========================================================================
    // 2. STARTUP MANAGEMENT
    // =========================================================================

    public IReadOnlyList<StartupItemEntry> InspectStartupItems()
    {
        var items = new List<StartupItemEntry>();

        // If custom startup directories are configured (e.g., for isolated testing), inspect them first.
        if (!string.IsNullOrWhiteSpace(_customUserStartupDir))
        {
            InspectStartupDirectory(
                _customUserStartupDir,
                _customDisabledStartupDir ?? Path.Combine(_customUserStartupDir, ".groundwork_disabled"),
                StartupEntryScope.CurrentUserStartupFolder,
                requiresAdmin: false,
                items);
            return items.OrderByDescending(i => i.IsEnabled).ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase).ToList();
        }

        if (!OperatingSystem.IsWindows())
        {
            return items;
        }

        // 1. HKCU Run (Enabled) + StartupApproved status
        var hkcuApprovedMap = ReadStartupApprovedMap(Registry.CurrentUser, HkcuStartupApprovedRunSubKey);
        InspectRegistryRunKey(
            Registry.CurrentUser,
            HkcuRunSubKey,
            StartupEntryScope.CurrentUserRegistry,
            isEnabledDefault: true,
            requiresAdmin: false,
            hkcuApprovedMap,
            items);

        // 2. HKCU Groundwork Disabled backup key
        InspectRegistryRunKey(
            Registry.CurrentUser,
            HkcuGroundworkDisabledRunSubKey,
            StartupEntryScope.CurrentUserRegistry,
            isEnabledDefault: false,
            requiresAdmin: false,
            approvedMap: null,
            items);

        // 3. HKLM Run
        InspectRegistryRunKey(
            Registry.LocalMachine,
            HklmRunSubKey,
            StartupEntryScope.LocalMachineRegistry,
            isEnabledDefault: true,
            requiresAdmin: true,
            approvedMap: null,
            items);

        // 4. HKLM WOW6432Node Run
        InspectRegistryRunKey(
            Registry.LocalMachine,
            HklmWow64RunSubKey,
            StartupEntryScope.LocalMachineWow64Registry,
            isEnabledDefault: true,
            requiresAdmin: true,
            approvedMap: null,
            items);

        // 5. User Startup Folder
        var userStartup = Environment.GetFolderPath(Environment.SpecialFolder.Startup);
        if (!string.IsNullOrWhiteSpace(userStartup))
        {
            var disabledFolder = Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Groundwork",
                "DisabledStartupFolderItems");
            InspectStartupDirectory(userStartup, disabledFolder, StartupEntryScope.CurrentUserStartupFolder, requiresAdmin: false, items);
        }

        // 6. Common Startup Folder
        var commonStartup = Environment.GetFolderPath(Environment.SpecialFolder.CommonStartup);
        if (!string.IsNullOrWhiteSpace(commonStartup))
        {
            InspectStartupDirectory(commonStartup, disabledBackupDir: null, StartupEntryScope.CommonStartupFolder, requiresAdmin: true, items);
        }

        // 7. Scheduled Startup / Logon Tasks (%SystemRoot%\System32\Tasks excluding \Microsoft\)
        InspectScheduledStartupTasks(items);

        return items
            .OrderByDescending(i => i.IsEnabled)
            .ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static void InspectScheduledStartupTasks(List<StartupItemEntry> output)
    {
        try
        {
            var sysRoot = Environment.GetFolderPath(Environment.SpecialFolder.Windows);
            if (string.IsNullOrWhiteSpace(sysRoot))
            {
                return;
            }

            var tasksRoot = Path.Combine(sysRoot, "System32", "Tasks");
            if (!Directory.Exists(tasksRoot))
            {
                return;
            }

            foreach (var file in Directory.EnumerateFiles(tasksRoot, "*", SearchOption.AllDirectories))
            {
                try
                {
                    var relPath = Path.GetRelativePath(tasksRoot, file);
                    if (relPath.StartsWith("Microsoft" + Path.DirectorySeparatorChar, StringComparison.OrdinalIgnoreCase) ||
                        relPath.StartsWith("Microsoft/", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var xmlText = File.ReadAllText(file);
                    var parsed = ParseScheduledTaskXml("\\" + relPath.Replace('/', '\\'), xmlText);
                    if (parsed is not null && !output.Any(e => string.Equals(e.EntryId, parsed.EntryId, StringComparison.OrdinalIgnoreCase)))
                    {
                        output.Add(parsed);
                    }
                }
                catch
                {
                    // Skip unreadable task files.
                }
            }
        }
        catch
        {
            // Ignore task directory enumeration errors.
        }
    }

    public static StartupItemEntry? ParseScheduledTaskXml(string taskPath, string? xmlContent)
    {
        if (string.IsNullOrWhiteSpace(taskPath) || string.IsNullOrWhiteSpace(xmlContent))
        {
            return null;
        }

        try
        {
            var doc = XDocument.Parse(xmlContent);
            var root = doc.Root;
            if (root is null)
            {
                return null;
            }

            var triggersElem = root.Elements().FirstOrDefault(e => e.Name.LocalName == "Triggers");
            if (triggersElem is null)
            {
                return null;
            }

            var hasStartupTrigger = triggersElem.Elements().Any(e =>
                e.Name.LocalName is "LogonTrigger" or "BootTrigger");
            if (!hasStartupTrigger)
            {
                return null;
            }

            var settingsElem = root.Elements().FirstOrDefault(e => e.Name.LocalName == "Settings");
            var enabledStr = settingsElem?.Elements().FirstOrDefault(e => e.Name.LocalName == "Enabled")?.Value;
            var isEnabled = !string.Equals(enabledStr, "false", StringComparison.OrdinalIgnoreCase);

            var actionsElem = root.Elements().FirstOrDefault(e => e.Name.LocalName == "Actions");
            var execElem = actionsElem?.Elements().FirstOrDefault(e => e.Name.LocalName == "Exec");
            var cmd = execElem?.Elements().FirstOrDefault(e => e.Name.LocalName == "Command")?.Value?.Trim() ?? string.Empty;
            var args = execElem?.Elements().FirstOrDefault(e => e.Name.LocalName == "Arguments")?.Value?.Trim() ?? string.Empty;

            if (string.IsNullOrWhiteSpace(cmd))
            {
                return null;
            }

            var fullCommand = string.IsNullOrWhiteSpace(args) ? cmd : $"{cmd} {args}";
            var exePath = ExtractExecutablePathFromCommand(cmd);
            var targetExists = !string.IsNullOrWhiteSpace(exePath) && File.Exists(exePath);
            var publisher = ReadExecutablePublisher(exePath);

            var regInfo = root.Elements().FirstOrDefault(e => e.Name.LocalName == "RegistrationInfo");
            var author = regInfo?.Elements().FirstOrDefault(e => e.Name.LocalName == "Author")?.Value?.Trim();
            if ((publisher == "Unknown / Target Missing" || publisher == "Unverified Publisher") && !string.IsNullOrWhiteSpace(author))
            {
                publisher = author;
            }

            var friendlyName = taskPath.TrimStart('\\');
            var (impact, reason) = AssessStartupImpact(friendlyName, fullCommand, exePath, targetExists, publisher);

            return new StartupItemEntry(
                EntryId: $"{StartupEntryScope.ScheduledStartupTask}:{taskPath}",
                Name: friendlyName,
                CommandOrTarget: fullCommand,
                ExecutablePath: string.IsNullOrWhiteSpace(exePath) ? cmd : exePath,
                Publisher: publisher,
                Scope: StartupEntryScope.ScheduledStartupTask,
                LocationDisplay: $"Task Scheduler ({taskPath})",
                IsEnabled: isEnabled,
                TargetExists: targetExists,
                ImpactAssessment: impact,
                ImpactReason: $"{reason} (Triggered via Windows Task Scheduler at Logon/Boot).",
                RequiresAdminToModify: false);
        }
        catch
        {
            return null;
        }
    }

    private static Dictionary<string, bool> ReadStartupApprovedMap(RegistryKey root, string subKeyPath)
    {
        var map = new Dictionary<string, bool>(StringComparer.OrdinalIgnoreCase);
        try
        {
            using var key = root.OpenSubKey(subKeyPath, writable: false);
            if (key is null)
            {
                return map;
            }

            foreach (var valueName in key.GetValueNames())
            {
                if (key.GetValue(valueName) is byte[] bytes && bytes.Length >= 1)
                {
                    // In Windows StartupApproved\Run, byte[0] == 2 or 6 means enabled; 3 means disabled by user.
                    var isEnabled = bytes[0] != 3 && bytes[0] != 1;
                    map[valueName] = isEnabled;
                }
            }
        }
        catch
        {
            // Ignore access errors.
        }
        return map;
    }

    private static void InspectRegistryRunKey(
        RegistryKey root,
        string subKeyPath,
        StartupEntryScope scope,
        bool isEnabledDefault,
        bool requiresAdmin,
        Dictionary<string, bool>? approvedMap,
        List<StartupItemEntry> output)
    {
        try
        {
            using var key = root.OpenSubKey(subKeyPath, writable: false);
            if (key is null)
            {
                return;
            }

            foreach (var valueName in key.GetValueNames())
            {
                if (string.IsNullOrWhiteSpace(valueName))
                {
                    continue;
                }

                var rawCommand = Convert.ToString(key.GetValue(valueName))?.Trim() ?? string.Empty;
                if (string.IsNullOrWhiteSpace(rawCommand))
                {
                    continue;
                }

                var isEnabled = isEnabledDefault;
                if (isEnabled && approvedMap is not null && approvedMap.TryGetValue(valueName, out var approvedState))
                {
                    isEnabled = approvedState;
                }

                var exePath = ExtractExecutablePathFromCommand(rawCommand);
                var targetExists = !string.IsNullOrWhiteSpace(exePath) && File.Exists(exePath);
                var publisher = ReadExecutablePublisher(exePath);
                var (impact, reason) = AssessStartupImpact(valueName, rawCommand, exePath, targetExists, publisher);

                var entryId = $"{scope}:{valueName}";
                if (output.Any(existing => string.Equals(existing.EntryId, entryId, StringComparison.OrdinalIgnoreCase)))
                {
                    continue;
                }

                output.Add(new StartupItemEntry(
                    EntryId: entryId,
                    Name: valueName,
                    CommandOrTarget: rawCommand,
                    ExecutablePath: string.IsNullOrWhiteSpace(exePath) ? rawCommand : exePath,
                    Publisher: publisher,
                    Scope: scope,
                    LocationDisplay: scope == StartupEntryScope.CurrentUserRegistry
                        ? @"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"
                        : (scope == StartupEntryScope.LocalMachineRegistry
                            ? @"HKLM\Software\Microsoft\Windows\CurrentVersion\Run"
                            : @"HKLM\Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run"),
                    IsEnabled: isEnabled,
                    TargetExists: targetExists,
                    ImpactAssessment: impact,
                    ImpactReason: reason,
                    RequiresAdminToModify: requiresAdmin));
            }
        }
        catch
        {
            // Ignore unreadable hive keys.
        }
    }

    private static void InspectStartupDirectory(
        string activeDir,
        string? disabledBackupDir,
        StartupEntryScope scope,
        bool requiresAdmin,
        List<StartupItemEntry> output)
    {
        try
        {
            if (Directory.Exists(activeDir))
            {
                foreach (var file in Directory.EnumerateFiles(activeDir))
                {
                    var fileName = Path.GetFileName(file);
                    if (string.Equals(fileName, "desktop.ini", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var publisher = ReadExecutablePublisher(file);
                    var (impact, reason) = AssessStartupImpact(Path.GetFileNameWithoutExtension(file), file, file, File.Exists(file), publisher);
                    output.Add(new StartupItemEntry(
                        EntryId: $"{scope}:{fileName}",
                        Name: Path.GetFileNameWithoutExtension(file),
                        CommandOrTarget: file,
                        ExecutablePath: file,
                        Publisher: publisher,
                        Scope: scope,
                        LocationDisplay: activeDir,
                        IsEnabled: true,
                        TargetExists: true,
                        ImpactAssessment: impact,
                        ImpactReason: reason,
                        RequiresAdminToModify: requiresAdmin));
                }
            }

            if (!string.IsNullOrWhiteSpace(disabledBackupDir) && Directory.Exists(disabledBackupDir))
            {
                foreach (var file in Directory.EnumerateFiles(disabledBackupDir))
                {
                    var fileName = Path.GetFileName(file);
                    if (string.Equals(fileName, "desktop.ini", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    var publisher = ReadExecutablePublisher(file);
                    var (impact, reason) = AssessStartupImpact(Path.GetFileNameWithoutExtension(file), file, file, File.Exists(file), publisher);
                    output.Add(new StartupItemEntry(
                        EntryId: $"{scope}:{fileName}",
                        Name: Path.GetFileNameWithoutExtension(file),
                        CommandOrTarget: Path.Combine(activeDir, fileName),
                        ExecutablePath: file,
                        Publisher: publisher,
                        Scope: scope,
                        LocationDisplay: activeDir,
                        IsEnabled: false,
                        TargetExists: true,
                        ImpactAssessment: impact,
                        ImpactReason: reason,
                        RequiresAdminToModify: requiresAdmin));
                }
            }
        }
        catch
        {
            // Ignore directory enumeration failures.
        }
    }

    public static string ExtractExecutablePathFromCommand(string? commandLine)
    {
        if (string.IsNullOrWhiteSpace(commandLine))
        {
            return string.Empty;
        }

        var trimmed = Environment.ExpandEnvironmentVariables(commandLine.Trim());
        if (trimmed.StartsWith('"'))
        {
            var endQuote = trimmed.IndexOf('"', 1);
            if (endQuote > 1)
            {
                return trimmed[1..endQuote];
            }
        }

        var exeIndex = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exeIndex > 0)
        {
            return trimmed[..(exeIndex + 4)].Trim();
        }

        var firstSpace = trimmed.IndexOf(' ');
        return firstSpace > 0 ? trimmed[..firstSpace] : trimmed;
    }

    private static string ReadExecutablePublisher(string? filePath)
    {
        if (string.IsNullOrWhiteSpace(filePath) || !File.Exists(filePath))
        {
            return "Unknown / Target Missing";
        }

        try
        {
            var info = FileVersionInfo.GetVersionInfo(filePath);
            if (!string.IsNullOrWhiteSpace(info.CompanyName))
            {
                return info.CompanyName.Trim();
            }
            if (!string.IsNullOrWhiteSpace(info.ProductName))
            {
                return info.ProductName.Trim();
            }
        }
        catch
        {
            // Ignore metadata read errors.
        }

        return Path.GetExtension(filePath).Equals(".lnk", StringComparison.OrdinalIgnoreCase)
            ? "Startup Shortcut (.lnk)"
            : "Unverified Publisher";
    }

    public static (string Impact, string Reason) AssessStartupImpact(
        string name,
        string command,
        string exePath,
        bool targetExists,
        string publisher)
    {
        if (!targetExists && !string.IsNullOrWhiteSpace(exePath))
        {
            return ("Orphaned Entry", "Target executable file does not exist on disk; likely a leftover from an uninstalled application.");
        }

        var lowerName = (name + " " + command).ToLowerInvariant();
        if (lowerName.Contains("securityhealth") || lowerName.Contains("windows defender") || lowerName.Contains("ctfmon"))
        {
            return ("System Component", "Core Windows security or input service helper; recommended to keep enabled.");
        }

        if (lowerName.Contains("steam") || lowerName.Contains("epicgames") || lowerName.Contains("discord") ||
            lowerName.Contains("spotify") || lowerName.Contains("teams") || lowerName.Contains("onedrive") ||
            lowerName.Contains("browser") || lowerName.Contains("chrome") || lowerName.Contains("msedge"))
        {
            return ("High Impact", "Launches a persistent multi-process client or background web runtime at login.");
        }

        if (lowerName.Contains("update") || lowerName.Contains("helper") || lowerName.Contains("tray"))
        {
            return ("Low / Medium Impact", "Background updater or tray notification utility.");
        }

        return ("Medium Impact", $"Starts automatically at sign-in ({publisher}).");
    }

    public OperationProposal ProposeToggleStartupItem(string entryId, bool targetEnabled)
    {
        var items = InspectStartupItems();
        var item = items.FirstOrDefault(i => string.Equals(i.EntryId, entryId, StringComparison.OrdinalIgnoreCase));

        var disabledBackupDir = !string.IsNullOrWhiteSpace(_customUserStartupDir)
            ? (_customDisabledStartupDir ?? Path.Combine(_customUserStartupDir, ".groundwork_disabled"))
            : Path.Combine(
                Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
                "Groundwork",
                "DisabledStartupFolderItems");

        var payload = new StartupTogglePayload(
            EntryId: item?.EntryId ?? entryId,
            Name: item?.Name ?? entryId,
            Scope: item?.Scope ?? StartupEntryScope.CurrentUserRegistry,
            CommandOrTarget: item?.CommandOrTarget ?? string.Empty,
            TargetEnabled: targetEnabled,
            DisabledBackupPath: disabledBackupDir);

        var payloadJson = JsonSerializer.Serialize(payload);
        var descriptor = item is { RequiresAdminToModify: true }
            ? StartupToggleDescriptor with { ElevationRequirement = OperationElevationRequirement.AdministratorRequired }
            : StartupToggleDescriptor;

        var actionVerb = targetEnabled ? "Enable" : "Disable";

        return _safeOperationEngine.CreateProposal(
            descriptor: descriptor,
            targetDescription: $"Startup Item: {item?.Name ?? entryId} ({item?.ScopeDisplay ?? "Unknown Scope"})",
            inspectedCurrentStateSummary: item is null
                ? $"Startup entry '{entryId}' was not found."
                : $"Entry '{item.Name}' is currently {(item.IsEnabled ? "Enabled" : "Disabled")} at {item.LocationDisplay}. Command: {item.CommandOrTarget}",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"{actionVerb} startup entry '{item?.Name ?? entryId}'. {(targetEnabled ? "The application will launch automatically at Windows sign-in." : "The application will no longer start automatically at sign-in, while preserving its command for one-click recovery.")}",
            expectedEffects:
            [
                targetEnabled
                    ? $"Restores '{item?.Name ?? entryId}' to active startup execution."
                    : $"Prevents '{item?.Name ?? entryId}' from launching automatically during login."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (item is null)
                {
                    return (false, $"Startup entry '{entryId}' was not found.");
                }
                if (item.Scope is StartupEntryScope.LocalMachineRegistry or StartupEntryScope.LocalMachineWow64Registry or StartupEntryScope.CommonStartupFolder)
                {
                    return (false, $"Startup entry '{item.Name}' is a machine-wide startup item ({item.ScopeDisplay}). Modifying machine-wide startup entries is blocked in standard mode to protect system stability.");
                }
                return (true, "User-scoped startup item can be safely toggled.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteStartupTogglePayloadAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<StartupTogglePayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid startup toggle payload.");

        ApplyStartupToggle(payload, payload.TargetEnabled);

        var afterItems = InspectStartupItems();
        var afterItem = afterItems.FirstOrDefault(i => string.Equals(i.EntryId, payload.EntryId, StringComparison.OrdinalIgnoreCase));
        var verified = afterItem is not null && afterItem.IsEnabled == payload.TargetEnabled;

        var stateText = afterItem is null
            ? "Entry not found after toggle"
            : $"Entry '{afterItem.Name}' is now {(afterItem.IsEnabled ? "Enabled" : "Disabled")}";

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: stateText,
            VerificationDetails: verified
                ? $"Verified that startup item '{payload.Name}' is {(payload.TargetEnabled ? "Enabled" : "Disabled")}."
                : $"Expected startup item '{payload.Name}' to be {(payload.TargetEnabled ? "Enabled" : "Disabled")}, but verification observed: {stateText}.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            PostStateSummary: stateText,
            StatusMessage: verified
                ? $"{(payload.TargetEnabled ? "Enabled" : "Disabled")} startup item '{payload.Name}'."
                : $"Failed to verify startup toggle for '{payload.Name}'.",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackStartupTogglePayloadAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<StartupTogglePayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid startup rollback payload.");

        var previousEnabled = !payload.TargetEnabled;
        ApplyStartupToggle(payload, previousEnabled);

        var afterItems = InspectStartupItems();
        var afterItem = afterItems.FirstOrDefault(i => string.Equals(i.EntryId, payload.EntryId, StringComparison.OrdinalIgnoreCase));
        var verified = afterItem is not null && afterItem.IsEnabled == previousEnabled;

        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: $"Startup item '{payload.Name}' is now {(previousEnabled ? "Enabled" : "Disabled")}",
            VerificationDetails: verified
                ? $"Restored '{payload.Name}' to its previous {(previousEnabled ? "Enabled" : "Disabled")} state."
                : $"Could not confirm rollback state for '{payload.Name}'.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            StatusMessage: verified
                ? $"Restored startup entry '{payload.Name}' to {(previousEnabled ? "Enabled" : "Disabled")}."
                : $"Failed to verify rollback for startup entry '{payload.Name}'.",
            Verification: verification));
    }

    private void ApplyStartupToggle(StartupTogglePayload payload, bool enable)
    {
        if (payload.Scope == StartupEntryScope.CurrentUserStartupFolder)
        {
            var activeDir = !string.IsNullOrWhiteSpace(_customUserStartupDir)
                ? _customUserStartupDir
                : Environment.GetFolderPath(Environment.SpecialFolder.Startup);
            var backupDir = payload.DisabledBackupPath;

            var fileName = Path.GetFileName(payload.CommandOrTarget);
            var activeFile = Path.Combine(activeDir, fileName);
            var backupFile = Path.Combine(backupDir, fileName);

            if (enable)
            {
                Directory.CreateDirectory(activeDir);
                if (File.Exists(backupFile))
                {
                    File.Move(backupFile, activeFile, overwrite: true);
                }
            }
            else
            {
                Directory.CreateDirectory(backupDir);
                if (File.Exists(activeFile))
                {
                    File.Move(activeFile, backupFile, overwrite: true);
                }
            }
            return;
        }

        if (payload.Scope == StartupEntryScope.CurrentUserRegistry && OperatingSystem.IsWindows())
        {
            using var activeKey = Registry.CurrentUser.CreateSubKey(HkcuRunSubKey, writable: true);
            using var backupKey = Registry.CurrentUser.CreateSubKey(HkcuGroundworkDisabledRunSubKey, writable: true);

            if (enable)
            {
                var cmd = Convert.ToString(backupKey?.GetValue(payload.Name)) ?? payload.CommandOrTarget;
                if (!string.IsNullOrWhiteSpace(cmd))
                {
                    activeKey?.SetValue(payload.Name, cmd, RegistryValueKind.String);
                }
                backupKey?.DeleteValue(payload.Name, throwOnMissingValue: false);

                // Also clear any disabled flag in StartupApproved\Run if present
                using var approvedKey = Registry.CurrentUser.OpenSubKey(HkcuStartupApprovedRunSubKey, writable: true);
                approvedKey?.DeleteValue(payload.Name, throwOnMissingValue: false);
            }
            else
            {
                var currentVal = Convert.ToString(activeKey?.GetValue(payload.Name)) ?? payload.CommandOrTarget;
                if (!string.IsNullOrWhiteSpace(currentVal))
                {
                    backupKey?.SetValue(payload.Name, currentVal, RegistryValueKind.String);
                }
                activeKey?.DeleteValue(payload.Name, throwOnMissingValue: false);
            }
            return;
        }

        if (payload.Scope == StartupEntryScope.ScheduledStartupTask && OperatingSystem.IsWindows())
        {
            var taskName = payload.EntryId.StartsWith($"{StartupEntryScope.ScheduledStartupTask}:", StringComparison.OrdinalIgnoreCase)
                ? payload.EntryId[($"{StartupEntryScope.ScheduledStartupTask}:".Length)..]
                : payload.Name;

            try
            {
                var psi = new ProcessStartInfo
                {
                    FileName = "schtasks.exe",
                    UseShellExecute = false,
                    RedirectStandardOutput = true,
                    RedirectStandardError = true,
                    CreateNoWindow = true
                };
                psi.ArgumentList.Add("/Change");
                psi.ArgumentList.Add("/TN");
                psi.ArgumentList.Add(taskName);
                psi.ArgumentList.Add(enable ? "/ENABLE" : "/DISABLE");

                using var proc = Process.Start(psi);
                proc?.WaitForExit(4000);
            }
            catch
            {
                // Ignore if task requires elevation or cannot be modified.
            }
        }
    }

    // =========================================================================
    // 3. WINDOWS PERFORMANCE, GAMING & PRIVACY CONFIGURATION
    // =========================================================================

    private sealed record SettingCompanionDword(string SubKey, string ValueName, int EnabledValue, int DisabledValue);
    private sealed record SettingStringSpec(string SubKey, string ValueName, string EnabledValue, string DisabledValue);

    private sealed record ConfigurableSettingSpec(
        string SettingId,
        string DisplayName,
        string Category,
        string SubKey,
        string ValueName,
        int DefaultDword,
        int EnabledDword,
        int DisabledDword,
        string EnabledDisplay,
        string DisabledDisplay,
        string Explanation,
        string RecommendationNote,
        OperationRiskLevel RiskLevel = OperationRiskLevel.Low,
        OperationElevationRequirement ElevationRequirement = OperationElevationRequirement.StandardUser,
        bool IsHklmReadOnly = false,
        bool IsSubKeyPresence = false,
        IReadOnlyList<SettingCompanionDword>? CompanionDwords = null,
        IReadOnlyList<SettingStringSpec>? StringValues = null);

    private static readonly IReadOnlyList<ConfigurableSettingSpec> SettingSpecs =
    [
        // UI & Context Menu
        new(
            SettingId: "customization.classic_context_menu",
            DisplayName: "Classic Windows 10 Full Right-Click Menu",
            Category: "UI & Context Menu",
            SubKey: @"Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}\InprocServer32",
            ValueName: string.Empty,
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Classic Full Menu (No 'Show more options' click)",
            DisabledDisplay: "Windows 11 Compact Menu (Default)",
            Explanation: "Restores the full right-click context menu in File Explorer and on the Desktop instead of hiding options behind 'Show more options'.",
            RecommendationNote: "Restart File Explorer after changing so the context menu updates immediately.",
            IsSubKeyPresence: true),
        new(
            SettingId: "customization.taskbar_end_task",
            DisplayName: "Taskbar Right-Click 'End Task'",
            Category: "UI & Context Menu",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced\TaskbarDeveloperSettings",
            ValueName: "TaskbarEndTask",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled (Right-click taskbar icon to kill hung apps)",
            DisabledDisplay: "Hidden (Default)",
            Explanation: "Adds an 'End task' command directly to the Windows 11 taskbar right-click menu so frozen apps can be closed without opening Task Manager.",
            RecommendationNote: "Instant power-user time saver; safe and reversible."),
        new(
            SettingId: "customization.show_file_extensions",
            DisplayName: "Show Known File Extensions in File Explorer",
            Category: "UI & Context Menu",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "HideFileExt",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Visible (.exe, .pdf, etc. shown)",
            DisabledDisplay: "Hidden",
            Explanation: "Displays full file extensions (such as .exe, .bat, .txt) in File Explorer instead of hiding known extensions.",
            RecommendationNote: "Recommended Enabled for security transparency so executables cannot masquerade as documents."),
        new(
            SettingId: "customization.show_hidden_files",
            DisplayName: "Show Hidden Files & Folders in File Explorer",
            Category: "UI & Context Menu",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "Hidden",
            DefaultDword: 2,
            EnabledDword: 1,
            DisabledDword: 2,
            EnabledDisplay: "Visible (AppData & hidden folders shown)",
            DisabledDisplay: "Hidden (Default)",
            Explanation: "Controls whether File Explorer displays files and directories marked with the Hidden attribute (such as AppData).",
            RecommendationNote: "Useful for troubleshooting app configurations and inspecting local caches."),
        new(
            SettingId: "customization.taskbar_left_align",
            DisplayName: "Align Windows 11 Taskbar Icons to Left",
            Category: "UI & Context Menu",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "TaskbarAl",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Left-Aligned",
            DisabledDisplay: "Center-Aligned (Windows 11 Default)",
            Explanation: "Sets the Windows 11 Taskbar Start button and pinned icons to classic left alignment (0) or centered alignment (1).",
            RecommendationNote: "Purely visual preference; reversible at any time without restarting."),
        new(
            SettingId: "customization.taskbar_seconds",
            DisplayName: "Show Seconds in Taskbar Clock",
            Category: "UI & Context Menu",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "ShowSecondsInSystemClock",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Showing HH:MM:SS",
            DisabledDisplay: "Hidden (HH:MM Default)",
            Explanation: "Displays seconds on the system tray clock for precise timing and troubleshooting.",
            RecommendationNote: "Reversible anytime; slightly increases taskbar clock redraw frequency."),

        // Debloat & Privacy
        new(
            SettingId: "debloat.disable_bing_search",
            DisplayName: "Disable Bing Web Search in Start Menu",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Policies\Microsoft\Windows\Explorer",
            ValueName: "DisableSearchBoxSuggestions",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Bing Disabled (Local PC Search Only)",
            DisabledDisplay: "Bing Web Results Enabled (Default)",
            Explanation: "Stops Windows Start Menu search from querying Bing web results and showing promoted web cards when searching for local apps and files.",
            RecommendationNote: "Recommended Enabled for faster, cleaner local search; restart Explorer to apply immediately.",
            CompanionDwords:
            [
                new SettingCompanionDword(@"Software\Microsoft\Windows\CurrentVersion\Search", "BingSearchEnabled", 0, 1)
            ]),
        new(
            SettingId: "debloat.disable_start_ads",
            DisplayName: "Block Windows Ads, Tips & Lock Screen Promos",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager",
            ValueName: "SystemPaneSuggestionsEnabled",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Blocked (Ads & Tips Disabled)",
            DisabledDisplay: "Allowed (Windows Default)",
            Explanation: "Disables promoted app suggestions in Start, Settings tips, lock screen spotlight fun facts, and 'Welcome Experience' banners.",
            RecommendationNote: "Recommended Enabled for a distraction-free desktop without losing core functionality.",
            CompanionDwords:
            [
                new SettingCompanionDword(@"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager", "SubscribedContent-338388Enabled", 0, 1),
                new SettingCompanionDword(@"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager", "SubscribedContent-338389Enabled", 0, 1),
                new SettingCompanionDword(@"Software\Microsoft\Windows\CurrentVersion\ContentDeliveryManager", "SubscribedContent-353698Enabled", 0, 1)
            ]),
        new(
            SettingId: "debloat.hide_widgets",
            DisplayName: "Hide Taskbar Widgets / MSN News Feed",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "TaskbarDa",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Hidden (Clean Taskbar)",
            DisabledDisplay: "Shown (Default)",
            Explanation: "Removes the Widgets / MSN Weather & News icon from the Windows 11 taskbar and reduces background feed refreshes.",
            RecommendationNote: "Safe UI cleanup; reversible anytime."),
        new(
            SettingId: "debloat.hide_copilot_button",
            DisplayName: "Hide Taskbar Copilot Button",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "ShowCopilotButton",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Hidden",
            DisabledDisplay: "Shown",
            Explanation: "Removes the built-in Copilot taskbar icon from the Windows 11 taskbar.",
            RecommendationNote: "Safe UI cleanup; reversible anytime."),
        new(
            SettingId: "privacy.advertising_id",
            DisplayName: "Personalized Advertising ID",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
            ValueName: "Enabled",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled",
            DisabledDisplay: "Disabled (Private)",
            Explanation: "Controls whether Windows maintains a unique per-user advertising identifier for apps to serve personalized ads.",
            RecommendationNote: "Recommended Off to prevent cross-app advertising tracking."),
        new(
            SettingId: "privacy.tailored_experiences",
            DisplayName: "Diagnostic Tailored Experiences",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Privacy",
            ValueName: "TailoredExperiencesWithDiagnosticDataEnabled",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled",
            DisabledDisplay: "Disabled (Private)",
            Explanation: "Controls whether Microsoft uses diagnostic data to show personalized tips, ads, and recommendations in Windows.",
            RecommendationNote: "Recommended Off to reduce promotional tips without affecting Windows stability."),
        new(
            SettingId: "privacy.activity_history",
            DisplayName: "Windows Activity History Tracking",
            Category: "Debloat & Privacy",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Privacy",
            ValueName: "ActivityHistoryEnabled",
            DefaultDword: 1,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled",
            DisabledDisplay: "Disabled (Private)",
            Explanation: "Controls whether Windows tracks recently used apps, files, and websites in local activity history.",
            RecommendationNote: "Recommended Off if you prefer private app/file usage while keeping Explorer recent files working."),

        // Gaming & Performance
        new(
            SettingId: "gaming.game_mode",
            DisplayName: "Windows Game Mode",
            Category: "Gaming & Performance",
            SubKey: @"Software\Microsoft\GameBar",
            ValueName: "AutoGameModeEnabled",
            DefaultDword: 1,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled (Default)",
            DisabledDisplay: "Disabled",
            Explanation: "When enabled, Windows prioritizes foreground game threads and suppresses background Windows Update restarts during gameplay.",
            RecommendationNote: "Recommended Enabled for systems used for gaming."),
        new(
            SettingId: "gaming.game_dvr",
            DisplayName: "Background Game DVR Capture",
            Category: "Gaming & Performance",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\GameDVR",
            ValueName: "AppCaptureEnabled",
            DefaultDword: 0,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled",
            DisabledDisplay: "Disabled",
            Explanation: "Controls whether Windows Game Bar records gameplay clips in the background using GPU encoding resources.",
            RecommendationNote: "Disabling avoids background GPU/VRAM overhead if you do not use Xbox Game Bar clip recording."),
        new(
            SettingId: "performance.visual_transparency",
            DisplayName: "Windows Acrylic & Mica Transparency Effects",
            Category: "Gaming & Performance",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            ValueName: "EnableTransparency",
            DefaultDword: 1,
            EnabledDword: 1,
            DisabledDword: 0,
            EnabledDisplay: "Enabled",
            DisabledDisplay: "Disabled",
            Explanation: "Controls translucent window backdrop rendering on the Taskbar, Start menu, and Fluent applications.",
            RecommendationNote: "Disabling reduces Desktop Window Manager (dwm.exe) GPU composition overhead on older or integrated GPUs."),
        new(
            SettingId: "performance.background_apps",
            DisplayName: "Background Store / UWP Application Activity",
            Category: "Gaming & Performance",
            SubKey: @"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications",
            ValueName: "GlobalUserDisabled",
            DefaultDword: 0,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Enabled (Apps can run in background)",
            DisabledDisplay: "Disabled (Restricted)",
            Explanation: "Controls whether packaged Windows applications can wake up, sync data, and consume CPU/RAM when closed.",
            RecommendationNote: "Disabling reduces background RAM usage and idle CPU wakeups on memory-constrained systems."),
        new(
            SettingId: "performance.hags",
            DisplayName: "Hardware-Accelerated GPU Scheduling (HAGS)",
            Category: "Gaming & Performance",
            SubKey: @"SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
            ValueName: "HwSchMode",
            DefaultDword: 2,
            EnabledDword: 2,
            DisabledDword: 1,
            EnabledDisplay: "Enabled (Requires supported GPU)",
            DisabledDisplay: "Disabled",
            Explanation: "Allows the GPU's dedicated scheduling processor to manage VRAM queues directly, and is required for DLSS 3 Frame Generation on supported GPUs.",
            RecommendationNote: "Machine-wide graphics setting (requires Administrator privileges and Windows Settings + reboot to change).",
            RiskLevel: OperationRiskLevel.Medium,
            ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
            IsHklmReadOnly: true),
        new(
            SettingId: "customization.disable_mouse_accel",
            DisplayName: "Disable Mouse Acceleration (1:1 Raw Pointer)",
            Category: "Gaming & Performance",
            SubKey: @"Control Panel\Mouse",
            ValueName: "MouseSpeed",
            DefaultDword: 1,
            EnabledDword: 0,
            DisabledDword: 1,
            EnabledDisplay: "Raw 1:1 Input (Pointer Precision Off)",
            DisabledDisplay: "Windows Mouse Acceleration On (Default)",
            Explanation: "Turns off Windows 'Enhance pointer precision' so cursor distance matches physical mouse movement consistently in games and precision work.",
            RecommendationNote: "Applies cleanly per user (signing out/re-opening Mouse Settings reflects the updated curve).",
            StringValues:
            [
                new SettingStringSpec(@"Control Panel\Mouse", "MouseSpeed", "0", "1"),
                new SettingStringSpec(@"Control Panel\Mouse", "MouseThreshold1", "0", "6"),
                new SettingStringSpec(@"Control Panel\Mouse", "MouseThreshold2", "0", "10")
            ])
    ];

    public IReadOnlyList<WindowsConfigurableSetting> InspectConfigurableSettings()
    {
        var results = new List<WindowsConfigurableSetting>(SettingSpecs.Count);
        foreach (var spec in SettingSpecs)
        {
            bool isEnabled;
            if (spec.IsHklmReadOnly)
            {
                isEnabled = ReadHklmDword(spec.SubKey, spec.ValueName, spec.DefaultDword) == spec.EnabledDword;
            }
            else if (spec.StringValues is { Count: > 0 })
            {
                var firstStr = spec.StringValues[0];
                var actual = ReadHkcuString(ResolveHkcuPath(firstStr.SubKey), firstStr.ValueName, firstStr.DisabledValue);
                isEnabled = string.Equals(actual, firstStr.EnabledValue, StringComparison.OrdinalIgnoreCase);
            }
            else if (spec.IsSubKeyPresence)
            {
                isEnabled = HkcuSubKeyExists(ResolveHkcuPath(spec.SubKey));
            }
            else
            {
                var raw = ReadHkcuDword(ResolveHkcuPath(spec.SubKey), spec.ValueName, spec.DefaultDword);
                isEnabled = raw == spec.EnabledDword;
            }

            results.Add(new WindowsConfigurableSetting(
                SettingId: spec.SettingId,
                DisplayName: spec.DisplayName,
                Category: spec.Category,
                CurrentStateDisplay: isEnabled ? spec.EnabledDisplay : spec.DisabledDisplay,
                IsEnabled: isEnabled,
                RegistryPath: (spec.IsHklmReadOnly ? @"HKLM\" : @"HKCU\") + spec.SubKey,
                ValueName: string.IsNullOrEmpty(spec.ValueName) ? "(Default)" : spec.ValueName,
                Explanation: spec.Explanation,
                RecommendationNote: spec.RecommendationNote,
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: spec.RiskLevel,
                ElevationRequirement: spec.ElevationRequirement));
        }

        return results;
    }

    private SettingTogglePayload CaptureSettingPayload(string settingId, bool targetEnabled, WindowsConfigurableSetting? setting = null)
    {
        var spec = SettingSpecs.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));
        int? previousRaw = null;
        bool? previousSubKey = null;
        Dictionary<string, int?>? previousCompanions = null;
        Dictionary<string, string?>? previousStrings = null;

        if (spec is not null && !spec.IsHklmReadOnly)
        {
            if (spec.StringValues is { Count: > 0 })
            {
                previousStrings = new Dictionary<string, string?>(StringComparer.OrdinalIgnoreCase);
                foreach (var str in spec.StringValues)
                {
                    previousStrings[$"{str.SubKey}|{str.ValueName}"] =
                        ReadNullableHkcuString(ResolveHkcuPath(str.SubKey), str.ValueName);
                }
            }
            else if (spec.IsSubKeyPresence)
            {
                previousSubKey = HkcuSubKeyExists(ResolveHkcuPath(spec.SubKey));
            }
            else
            {
                previousRaw = ReadNullableHkcuDword(ResolveHkcuPath(spec.SubKey), spec.ValueName);
                if (spec.CompanionDwords is { Count: > 0 })
                {
                    previousCompanions = new Dictionary<string, int?>(StringComparer.OrdinalIgnoreCase);
                    foreach (var comp in spec.CompanionDwords)
                    {
                        previousCompanions[$"{comp.SubKey}|{comp.ValueName}"] =
                            ReadNullableHkcuDword(ResolveHkcuPath(comp.SubKey), comp.ValueName);
                    }
                }
            }
        }

        return new SettingTogglePayload(
            SettingId: setting?.SettingId ?? spec?.SettingId ?? settingId,
            DisplayName: setting?.DisplayName ?? spec?.DisplayName ?? settingId,
            TargetEnabled: targetEnabled,
            PreviousDwordValue: previousRaw,
            PreviousSubKeyExisted: previousSubKey,
            PreviousCompanionDwords: previousCompanions,
            PreviousStrings: previousStrings);
    }

    public OperationProposal ProposeToggleSetting(string settingId, bool targetEnabled)
    {
        var spec = SettingSpecs.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));
        var setting = InspectConfigurableSettings()
            .FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));

        var payload = CaptureSettingPayload(settingId, targetEnabled, setting);
        var payloadJson = JsonSerializer.Serialize(payload);

        var descriptor = setting is not null
            ? SettingToggleDescriptor with
            {
                RiskLevel = setting.RiskLevel,
                ElevationRequirement = setting.ElevationRequirement
            }
            : SettingToggleDescriptor;

        return _safeOperationEngine.CreateProposal(
            descriptor: descriptor,
            targetDescription: $"{setting?.DisplayName ?? settingId} ({setting?.RegistryPath}\\{setting?.ValueName})",
            inspectedCurrentStateSummary: setting is null
                ? $"Setting '{settingId}' is unknown."
                : $"{setting.DisplayName} is currently {setting.CurrentStateDisplay}.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Set '{setting?.DisplayName ?? settingId}' to {(targetEnabled ? "Enabled" : "Disabled")}. {setting?.Explanation}",
            expectedEffects:
            [
                setting?.RecommendationNote ?? "Updates registry configuration value."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (spec is null || setting is null)
                {
                    return (false, $"Setting '{settingId}' is not a supported configurable setting.");
                }
                if (spec.IsHklmReadOnly)
                {
                    return (false, "Hardware-Accelerated GPU Scheduling (HAGS) modifies HKLM kernel graphics driver configuration and requires changing via Windows System > Display > Graphics > Default graphics settings followed by a reboot.");
                }
                return (true, "Supported user-scoped registry setting.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteSettingTogglePayloadAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<SettingTogglePayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid setting toggle payload.");

        ApplySettingState(payload.SettingId, payload.TargetEnabled);
        var after = InspectConfigurableSettings()
            .FirstOrDefault(s => string.Equals(s.SettingId, payload.SettingId, StringComparison.OrdinalIgnoreCase));

        var verified = after is not null && after.IsEnabled == payload.TargetEnabled;
        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: after is not null ? $"{after.DisplayName}: {after.CurrentStateDisplay}" : "Unable to read setting state",
            VerificationDetails: verified
                ? $"Verified registry value for '{payload.DisplayName}' reflects {(payload.TargetEnabled ? "Enabled" : "Disabled")}."
                : $"Verification mismatch for '{payload.DisplayName}'.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: verified
                ? $"Updated '{payload.DisplayName}' to {(payload.TargetEnabled ? "Enabled" : "Disabled")}."
                : $"Failed to verify setting update for '{payload.DisplayName}'.",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackSettingTogglePayloadAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<SettingTogglePayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid setting rollback payload.");

        var previousEnabled = !payload.TargetEnabled;
        RestoreSettingState(payload, previousEnabled);

        var after = InspectConfigurableSettings()
            .FirstOrDefault(s => string.Equals(s.SettingId, payload.SettingId, StringComparison.OrdinalIgnoreCase));

        var verified = after is not null && after.IsEnabled == previousEnabled;
        var verification = new OperationVerificationResult(
            IsVerified: verified,
            ObservedStateSummary: after is not null ? $"{after.DisplayName}: {after.CurrentStateDisplay}" : "Unknown",
            VerificationDetails: verified
                ? $"Restored '{payload.DisplayName}' to its previous value."
                : $"Could not confirm rollback state for '{payload.DisplayName}'.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: verified,
            StatusMessage: verified
                ? $"Restored '{payload.DisplayName}' to its previous state."
                : $"Failed to verify rollback for '{payload.DisplayName}'.",
            Verification: verification));
    }

    private string ResolveHkcuPath(string subKey) =>
        string.IsNullOrEmpty(_hkcuSettingsPrefix) ? subKey : _hkcuSettingsPrefix + subKey;

    private void ApplySettingState(string settingId, bool enabled)
    {
        if (!OperatingSystem.IsWindows()) return;
        var spec = SettingSpecs.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));
        if (spec is null || spec.IsHklmReadOnly) return;

        if (spec.StringValues is { Count: > 0 })
        {
            foreach (var str in spec.StringValues)
            {
                WriteHkcuString(ResolveHkcuPath(str.SubKey), str.ValueName, enabled ? str.EnabledValue : str.DisabledValue);
            }
            return;
        }

        if (spec.IsSubKeyPresence)
        {
            ApplySubKeyPresence(spec.SubKey, present: enabled);
            return;
        }

        WriteHkcuDword(ResolveHkcuPath(spec.SubKey), spec.ValueName, enabled ? spec.EnabledDword : spec.DisabledDword);
        if (spec.CompanionDwords is { Count: > 0 })
        {
            foreach (var comp in spec.CompanionDwords)
            {
                WriteHkcuDword(ResolveHkcuPath(comp.SubKey), comp.ValueName, enabled ? comp.EnabledValue : comp.DisabledValue);
            }
        }
    }

    private void RestoreSettingState(SettingTogglePayload payload, bool fallbackEnabled)
    {
        if (!OperatingSystem.IsWindows()) return;
        var spec = SettingSpecs.FirstOrDefault(s => string.Equals(s.SettingId, payload.SettingId, StringComparison.OrdinalIgnoreCase));
        if (spec is null || spec.IsHklmReadOnly) return;

        if (spec.StringValues is { Count: > 0 })
        {
            foreach (var str in spec.StringValues)
            {
                var key = $"{str.SubKey}|{str.ValueName}";
                if (payload.PreviousStrings is not null && payload.PreviousStrings.TryGetValue(key, out var prevStr) && prevStr is not null)
                {
                    WriteHkcuString(ResolveHkcuPath(str.SubKey), str.ValueName, prevStr);
                }
                else
                {
                    DeleteHkcuValue(ResolveHkcuPath(str.SubKey), str.ValueName);
                }
            }
            return;
        }

        if (spec.IsSubKeyPresence)
        {
            ApplySubKeyPresence(spec.SubKey, present: payload.PreviousSubKeyExisted ?? fallbackEnabled);
            return;
        }

        if (payload.PreviousDwordValue.HasValue)
        {
            WriteHkcuDword(ResolveHkcuPath(spec.SubKey), spec.ValueName, payload.PreviousDwordValue.Value);
        }
        else
        {
            DeleteHkcuValue(ResolveHkcuPath(spec.SubKey), spec.ValueName);
        }

        if (spec.CompanionDwords is { Count: > 0 } && payload.PreviousCompanionDwords is not null)
        {
            foreach (var comp in spec.CompanionDwords)
            {
                var key = $"{comp.SubKey}|{comp.ValueName}";
                if (payload.PreviousCompanionDwords.TryGetValue(key, out var prevVal) && prevVal.HasValue)
                {
                    WriteHkcuDword(ResolveHkcuPath(comp.SubKey), comp.ValueName, prevVal.Value);
                }
                else
                {
                    DeleteHkcuValue(ResolveHkcuPath(comp.SubKey), comp.ValueName);
                }
            }
        }
    }

    private void ApplySubKeyPresence(string subKey, bool present)
    {
        var fullSubKey = ResolveHkcuPath(subKey);
        if (present)
        {
            using var key = Registry.CurrentUser.CreateSubKey(fullSubKey, writable: true);
            key?.SetValue(string.Empty, string.Empty, RegistryValueKind.String);
        }
        else
        {
            var lastSlash = fullSubKey.LastIndexOf('\\');
            if (lastSlash > 0)
            {
                var parentPath = fullSubKey[..lastSlash];
                var childName = fullSubKey[(lastSlash + 1)..];
                using var parent = Registry.CurrentUser.OpenSubKey(parentPath, writable: true);
                parent?.DeleteSubKeyTree(childName, throwOnMissingSubKey: false);

                // Clean up empty CLSID GUID wrapper key when removing Classic Context Menu override
                var parentSlash = parentPath.LastIndexOf('\\');
                if (parentSlash > 0 && parentPath.EndsWith("}", StringComparison.Ordinal))
                {
                    var grandParentPath = parentPath[..parentSlash];
                    var guidFolder = parentPath[(parentSlash + 1)..];
                    using var check = Registry.CurrentUser.OpenSubKey(parentPath, writable: false);
                    if (check is not null && check.SubKeyCount == 0 && check.ValueCount == 0)
                    {
                        using var grandParent = Registry.CurrentUser.OpenSubKey(grandParentPath, writable: true);
                        grandParent?.DeleteSubKeyTree(guidFolder, throwOnMissingSubKey: false);
                    }
                }
            }
        }
    }

    public static bool RestartFileExplorer()
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            foreach (var proc in Process.GetProcessesByName("explorer"))
            {
                try
                {
                    proc.Kill(entireProcessTree: false);
                    proc.WaitForExit(3000);
                }
                catch { }
                finally
                {
                    proc.Dispose();
                }
            }

            Process.Start(new ProcessStartInfo
            {
                FileName = "explorer.exe",
                UseShellExecute = true
            });
            return true;
        }
        catch
        {
            return false;
        }
    }

    private static bool HkcuSubKeyExists(string subKey)
    {
        if (!OperatingSystem.IsWindows()) return false;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(subKey, writable: false);
            return key is not null;
        }
        catch
        {
            return false;
        }
    }

    private static int ReadHkcuDword(string subKey, string valueName, int defaultValue)
    {
        return ReadNullableHkcuDword(subKey, valueName) ?? defaultValue;
    }

    private static int? ReadNullableHkcuDword(string subKey, string valueName)
    {
        if (!OperatingSystem.IsWindows())
        {
            return null;
        }

        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(subKey, writable: false);
            var val = key?.GetValue(valueName);
            return val is not null ? Convert.ToInt32(val) : null;
        }
        catch
        {
            return null;
        }
    }

    private static int ReadHklmDword(string subKey, string valueName, int defaultValue)
    {
        if (!OperatingSystem.IsWindows())
        {
            return defaultValue;
        }

        try
        {
            using var key = Registry.LocalMachine.OpenSubKey(subKey, writable: false);
            var val = key?.GetValue(valueName);
            return val is not null ? Convert.ToInt32(val) : defaultValue;
        }
        catch
        {
            return defaultValue;
        }
    }

    private static void WriteHkcuDword(string subKey, string valueName, int value)
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        using var key = Registry.CurrentUser.CreateSubKey(subKey, writable: true);
        key?.SetValue(valueName, value, RegistryValueKind.DWord);
    }

    private static void DeleteHkcuValue(string subKey, string valueName)
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(subKey, writable: true);
            key?.DeleteValue(valueName, throwOnMissingValue: false);
        }
        catch { }
    }

    private static string ReadHkcuString(string subKey, string valueName, string defaultValue) =>
        ReadNullableHkcuString(subKey, valueName) ?? defaultValue;

    private static string? ReadNullableHkcuString(string subKey, string valueName)
    {
        if (!OperatingSystem.IsWindows()) return null;
        try
        {
            using var key = Registry.CurrentUser.OpenSubKey(subKey, writable: false);
            return key?.GetValue(valueName)?.ToString();
        }
        catch { return null; }
    }

    private static void WriteHkcuString(string subKey, string valueName, string value)
    {
        if (!OperatingSystem.IsWindows()) return;
        using var key = Registry.CurrentUser.CreateSubKey(subKey, writable: true);
        key?.SetValue(valueName, value, RegistryValueKind.String);
    }

    // =========================================================================
    // 4. BATCH TWEAK PRESETS & HIBERNATION CONTROL
    // =========================================================================

    public OperationProposal ProposeApplyTweakPreset(string presetName, IReadOnlyDictionary<string, bool> desiredStates)
    {
        ArgumentNullException.ThrowIfNull(desiredStates);
        var current = InspectConfigurableSettings();
        var items = new List<SettingTogglePayload>();
        var summaryLines = new List<string>();

        foreach (var (settingId, targetEnabled) in desiredStates)
        {
            var setting = current.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));
            var spec = SettingSpecs.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));
            if (spec is null || spec.IsHklmReadOnly || setting is null) continue;
            items.Add(CaptureSettingPayload(settingId, targetEnabled, setting));
            summaryLines.Add($"{setting.DisplayName} → {(targetEnabled ? "On" : "Off")}");
        }

        var payloadJson = JsonSerializer.Serialize(new TweakPresetPayload(presetName, items));
        return _safeOperationEngine.CreateProposal(
            descriptor: TweakPresetDescriptor with { DisplayName = $"Apply {presetName}" },
            targetDescription: $"{presetName} ({items.Count} Windows settings)",
            inspectedCurrentStateSummary: $"{items.Count} user-scoped tweaks staged for update.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Applies '{presetName}': {string.Join("; ", summaryLines.Take(4))}{(summaryLines.Count > 4 ? $" (+{summaryLines.Count - 4} more)" : string.Empty)}.",
            expectedEffects: summaryLines,
            payloadJson: payloadJson,
            customPrerequisiteValidator: () => items.Count > 0
                ? (true, "All preset settings validated.")
                : (false, "No eligible user-scoped settings in preset."));
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteTweakPresetAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<TweakPresetPayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid preset payload.");

        foreach (var item in payload.Items)
        {
            ApplySettingState(item.SettingId, item.TargetEnabled);
        }

        var after = InspectConfigurableSettings();
        var verifiedCount = payload.Items.Count(item =>
            after.FirstOrDefault(s => string.Equals(s.SettingId, item.SettingId, StringComparison.OrdinalIgnoreCase))?.IsEnabled == item.TargetEnabled);
        var ok = verifiedCount == payload.Items.Count;
        var summary = ok
            ? $"Applied '{payload.PresetName}' ({verifiedCount}/{payload.Items.Count} settings verified). Click 'Restart File Explorer' to refresh desktop/menu tweaks."
            : $"Applied '{payload.PresetName}' ({verifiedCount}/{payload.Items.Count} verified).";

        return Task.FromResult((ok, summary, summary, new OperationVerificationResult(ok, summary, summary, DateTimeOffset.UtcNow)));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackTweakPresetAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<TweakPresetPayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid preset rollback state.");

        foreach (var item in payload.Items)
        {
            RestoreSettingState(item, !item.TargetEnabled);
        }

        var summary = $"Restored all {payload.Items.Count} setting(s) modified by '{payload.PresetName}'.";
        return Task.FromResult((true, summary, new OperationVerificationResult(true, summary, summary, DateTimeOffset.UtcNow)));
    }

    public (bool IsEnabled, long HiberfileBytes) InspectHibernationStatus()
    {
        var enabled = ReadHklmDword(@"SYSTEM\CurrentControlSet\Control\Power", "HibernateEnabled", 1) != 0;
        long bytes = 0;
        if (OperatingSystem.IsWindows())
        {
            try
            {
                var root = Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
                var hiberPath = Path.Combine(root, "hiberfil.sys");
                if (File.Exists(hiberPath))
                {
                    bytes = new FileInfo(hiberPath).Length;
                }
            }
            catch { }
        }
        return (enabled, bytes);
    }

    public OperationProposal ProposeToggleHibernation(bool targetEnabled)
    {
        var (currentEnabled, hiberBytes) = InspectHibernationStatus();
        var payloadJson = JsonSerializer.Serialize(new HibernateTogglePayload(targetEnabled, currentEnabled));
        var sizeText = hiberBytes > 0 ? $"{hiberBytes / (1024.0 * 1024.0 * 1024.0):F1} GB" : "several GB";

        return _safeOperationEngine.CreateProposal(
            descriptor: HibernateToggleDescriptor,
            targetDescription: $"Windows Hibernation ({(targetEnabled ? "Enable" : "Disable")} / C:\\hiberfil.sys)",
            inspectedCurrentStateSummary: currentEnabled
                ? $"Hibernation Enabled ({(hiberBytes > 0 ? $"{sizeText} reserved in hiberfil.sys" : "active")})"
                : "Hibernation Disabled (no hiberfil.sys)",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: targetEnabled
                ? "Runs 'powercfg /hibernate on' to enable Windows Hibernation and Fast Startup."
                : $"Runs 'powercfg /hibernate off' to reclaim ~{sizeText} of SSD storage immediately.",
            expectedEffects:
            [
                targetEnabled ? "Creates C:\\hiberfil.sys for Hibernate & Fast Startup." : $"Deletes C:\\hiberfil.sys ({sizeText} freed); disables Fast Startup."
            ],
            payloadJson: payloadJson);
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteHibernateToggleAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<HibernateTogglePayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid hibernation payload.");

        RunPowerCfg(["/hibernate", payload.TargetEnabled ? "on" : "off"]);
        var (afterEnabled, afterBytes) = InspectHibernationStatus();
        var verified = afterEnabled == payload.TargetEnabled;
        var summary = verified
            ? (payload.TargetEnabled
                ? "Enabled Windows Hibernation."
                : $"Disabled Windows Hibernation and removed hiberfil.sys.")
            : $"Could not change hibernation state (observed Enabled={afterEnabled}).";

        return Task.FromResult((verified, summary, summary, new OperationVerificationResult(verified, $"HibernateEnabled={afterEnabled}, Bytes={afterBytes}", summary, DateTimeOffset.UtcNow)));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackHibernateToggleAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<HibernateTogglePayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid hibernation rollback state.");

        RunPowerCfg(["/hibernate", payload.PreviousEnabled ? "on" : "off"]);
        var (afterEnabled, _) = InspectHibernationStatus();
        var verified = afterEnabled == payload.PreviousEnabled;
        var summary = verified
            ? $"Restored Windows Hibernation to {(payload.PreviousEnabled ? "Enabled" : "Disabled")}."
            : "Could not verify hibernation rollback.";
        return Task.FromResult((verified, summary, new OperationVerificationResult(verified, summary, summary, DateTimeOffset.UtcNow)));
    }
}
