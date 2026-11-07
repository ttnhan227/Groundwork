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
    public const string StartupToggleOperationId = "startup.toggle_item";
    public const string SettingToggleOperationId = "settings.toggle_user_setting";

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

    private sealed record PowerSwitchPayload(string TargetSchemeGuid, string TargetSchemeName, string PreviousSchemeGuid, string PreviousSchemeName);
    private sealed record StartupTogglePayload(string EntryId, string Name, StartupEntryScope Scope, string CommandOrTarget, bool TargetEnabled, string DisabledBackupPath);
    private sealed record SettingTogglePayload(string SettingId, string DisplayName, bool TargetEnabled, int? PreviousDwordValue);

    public WindowsOptimizationService(
        SafeOperationEngine? safeOperationEngine = null,
        string? customUserStartupDir = null,
        string? customDisabledStartupDir = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _customUserStartupDir = customUserStartupDir;
        _customDisabledStartupDir = customDisabledStartupDir;

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
        DisplayName: "Configure Windows Performance / Privacy Setting",
        Category: "Optimize / Windows Configuration",
        Description: "Updates a user-scoped Windows configuration value in HKCU and records the previous value for rollback.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Visual or Explorer settings may require restarting File Explorer or signing out to take full visual effect."
        ],
        VerificationMethodDescription: "Reads back the registry value in HKCU to verify it matches the target configuration.",
        RollbackMethodDescription: "Writes back the captured pre-change DWORD value (or deletes the value if it did not previously exist).");

    private void RegisterOperationHandlers()
    {
        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: PowerSwitchDescriptor,
            ExecuteAsync: ExecutePowerSwitchPayloadAsync,
            RollbackAsync: RollbackPowerSwitchPayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: StartupToggleDescriptor,
            ExecuteAsync: ExecuteStartupTogglePayloadAsync,
            RollbackAsync: RollbackStartupTogglePayloadAsync));

        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: SettingToggleDescriptor,
            ExecuteAsync: ExecuteSettingTogglePayloadAsync,
            RollbackAsync: RollbackSettingTogglePayloadAsync));
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

    private static string RunPowerCfg(IReadOnlyList<string> args)
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

    public IReadOnlyList<WindowsConfigurableSetting> InspectConfigurableSettings()
    {
        var settings = new List<WindowsConfigurableSetting>();

        // 1. Windows Game Mode
        var gameModeVal = ReadHkcuDword(@"Software\Microsoft\GameBar", "AutoGameModeEnabled", defaultValue: 1);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "gaming.game_mode",
            DisplayName: "Windows Game Mode",
            Category: "Gaming & Performance",
            CurrentStateDisplay: gameModeVal != 0 ? "Enabled (Default)" : "Disabled",
            IsEnabled: gameModeVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\GameBar",
            ValueName: "AutoGameModeEnabled",
            Explanation: "When enabled, Windows prioritizes foreground game threads and suppresses background Windows Update driver installations and restart notifications during gameplay.",
            RecommendationNote: "Recommended Enabled for systems used for gaming.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 2. Background Game Recording (Game DVR)
        var dvrVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled", defaultValue: 0);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "gaming.game_dvr",
            DisplayName: "Background Game DVR Capture",
            Category: "Gaming & Performance",
            CurrentStateDisplay: dvrVal != 0 ? "Enabled" : "Disabled",
            IsEnabled: dvrVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\GameDVR",
            ValueName: "AppCaptureEnabled",
            Explanation: "Controls whether Windows Game Bar records gameplay clips in the background using GPU encoding resources.",
            RecommendationNote: "Disabling avoids background GPU/VRAM overhead if you do not use Xbox Game Bar clip recording.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 3. Visual Transparency Effects
        var transparencyVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", defaultValue: 1);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "performance.visual_transparency",
            DisplayName: "Windows Acrylic & Mica Transparency Effects",
            Category: "Performance & Visuals",
            CurrentStateDisplay: transparencyVal != 0 ? "Enabled" : "Disabled",
            IsEnabled: transparencyVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Themes\Personalize",
            ValueName: "EnableTransparency",
            Explanation: "Controls translucent window backdrop rendering on the Taskbar, Start menu, and Fluent applications.",
            RecommendationNote: "Disabling reduces Desktop Window Manager (dwm.exe) GPU composition overhead on integrated GPUs or older laptops.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 4. Background Application Activity
        var bgDisabledVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications", "GlobalUserDisabled", defaultValue: 0);
        var bgAppsAllowed = bgDisabledVal == 0;
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "performance.background_apps",
            DisplayName: "Background Store / UWP Application Activity",
            Category: "Performance & Resource Control",
            CurrentStateDisplay: bgAppsAllowed ? "Enabled (Apps can run in background)" : "Disabled (Restricted)",
            IsEnabled: bgAppsAllowed,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications",
            ValueName: "GlobalUserDisabled",
            Explanation: "Controls whether packaged Windows applications can wake up, sync data, and consume CPU/RAM when their windows are closed.",
            RecommendationNote: "Disabling reduces background RAM usage and idle CPU wakeups on memory-constrained systems.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 5. Hardware-Accelerated GPU Scheduling (HAGS - Read/Inspect with Admin requirement note)
        var hagsVal = ReadHklmDword(@"SYSTEM\CurrentControlSet\Control\GraphicsDrivers", "HwSchMode", defaultValue: 2);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "performance.hags",
            DisplayName: "Hardware-Accelerated GPU Scheduling (HAGS)",
            Category: "Gaming & Performance",
            CurrentStateDisplay: hagsVal == 2 ? "Enabled (Requires supported GPU)" : "Disabled",
            IsEnabled: hagsVal == 2,
            RegistryPath: @"HKLM\SYSTEM\CurrentControlSet\Control\GraphicsDrivers",
            ValueName: "HwSchMode",
            Explanation: "Allows the GPU's dedicated scheduling processor to manage VRAM queues directly, and is required for DLSS 3 Frame Generation on supported GPUs.",
            RecommendationNote: "Machine-wide graphics setting (requires Administrator privileges and a system restart to change).",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Medium,
            ElevationRequirement: OperationElevationRequirement.AdministratorRequired));

        // 6. Windows Advertising ID
        var adIdVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo", "Enabled", defaultValue: 0);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "privacy.advertising_id",
            DisplayName: "Personalized Advertising ID",
            Category: "Privacy",
            CurrentStateDisplay: adIdVal != 0 ? "Enabled" : "Disabled (Private)",
            IsEnabled: adIdVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo",
            ValueName: "Enabled",
            Explanation: "Controls whether Windows maintains a unique per-user advertising identifier for apps to serve personalized ads.",
            RecommendationNote: "Disabling resets the advertising ID and prevents apps from tracking cross-app usage via this identifier.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 7. Tailored Experiences with Diagnostic Data
        var tailoredVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "TailoredExperiencesWithDiagnosticDataEnabled", defaultValue: 0);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "privacy.tailored_experiences",
            DisplayName: "Diagnostic Tailored Experiences",
            Category: "Privacy",
            CurrentStateDisplay: tailoredVal != 0 ? "Enabled" : "Disabled (Private)",
            IsEnabled: tailoredVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Privacy",
            ValueName: "TailoredExperiencesWithDiagnosticDataEnabled",
            Explanation: "Controls whether Microsoft uses diagnostic data to show personalized tips, ads, and recommendations in Windows.",
            RecommendationNote: "Safe to disable to reduce promotional tips without affecting Windows stability.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 8. Windows Activity History Tracking
        var activityVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "ActivityHistoryEnabled", defaultValue: 1);
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "privacy.activity_history",
            DisplayName: "Windows Activity History Tracking",
            Category: "Privacy",
            CurrentStateDisplay: activityVal != 0 ? "Enabled" : "Disabled (Private)",
            IsEnabled: activityVal != 0,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Privacy",
            ValueName: "ActivityHistoryEnabled",
            Explanation: "Controls whether Windows tracks recently used apps, files, and websites in local activity history.",
            RecommendationNote: "Disabling stops activity history collection while keeping normal File Explorer recent files functional.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 9. Show File Extensions in File Explorer
        var hideExtVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "HideFileExt", defaultValue: 1);
        var showExtEnabled = hideExtVal == 0;
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "customization.show_file_extensions",
            DisplayName: "Show Known File Extensions in File Explorer",
            Category: "Windows Customization & Safety",
            CurrentStateDisplay: showExtEnabled ? "Visible (.exe, .pdf, etc. shown)" : "Hidden",
            IsEnabled: showExtEnabled,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "HideFileExt",
            Explanation: "Displays full file extensions (such as .exe, .bat, .txt) in File Explorer instead of hiding known extensions.",
            RecommendationNote: "Recommended Enabled for security transparency so executable files cannot masquerade as documents.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 10. Show Hidden Files & Folders in File Explorer
        var hiddenVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "Hidden", defaultValue: 2);
        var showHiddenEnabled = hiddenVal == 1;
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "customization.show_hidden_files",
            DisplayName: "Show Hidden Files & Folders in File Explorer",
            Category: "Windows Customization & Safety",
            CurrentStateDisplay: showHiddenEnabled ? "Visible (AppData & hidden folders shown)" : "Hidden (Default)",
            IsEnabled: showHiddenEnabled,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "Hidden",
            Explanation: "Controls whether File Explorer displays files and directories marked with the Hidden attribute (such as AppData).",
            RecommendationNote: "Useful for troubleshooting application configurations and inspecting local caches.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        // 11. Windows 11 Taskbar Left Alignment
        var taskbarAlVal = ReadHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAl", defaultValue: 1);
        var leftAligned = taskbarAlVal == 0;
        settings.Add(new WindowsConfigurableSetting(
            SettingId: "customization.taskbar_left_align",
            DisplayName: "Align Windows 11 Taskbar Icons to Left",
            Category: "Windows Customization & Safety",
            CurrentStateDisplay: leftAligned ? "Left-Aligned" : "Center-Aligned (Windows 11 Default)",
            IsEnabled: leftAligned,
            RegistryPath: @"HKCU\Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced",
            ValueName: "TaskbarAl",
            Explanation: "Sets the Windows 11 Taskbar Start button and pinned icons to classic left alignment (0) or centered alignment (1).",
            RecommendationNote: "Purely visual preference; reversible at any time without restarting.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser));

        return settings;
    }

    public OperationProposal ProposeToggleSetting(string settingId, bool targetEnabled)
    {
        var settings = InspectConfigurableSettings();
        var setting = settings.FirstOrDefault(s => string.Equals(s.SettingId, settingId, StringComparison.OrdinalIgnoreCase));

        var previousRaw = setting is not null ? ReadRawSettingValue(setting.SettingId) : null;
        var payload = new SettingTogglePayload(
            SettingId: setting?.SettingId ?? settingId,
            DisplayName: setting?.DisplayName ?? settingId,
            TargetEnabled: targetEnabled,
            PreviousDwordValue: previousRaw);
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
                if (setting is null)
                {
                    return (false, $"Setting '{settingId}' is not a supported configurable setting.");
                }
                if (string.Equals(setting.SettingId, "performance.hags", StringComparison.OrdinalIgnoreCase))
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

        WriteSettingState(payload.SettingId, payload.TargetEnabled);
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
        WriteSettingState(payload.SettingId, previousEnabled, payload.PreviousDwordValue);

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

    private static int? ReadRawSettingValue(string settingId)
    {
        return settingId switch
        {
            "gaming.game_mode" => ReadNullableHkcuDword(@"Software\Microsoft\GameBar", "AutoGameModeEnabled"),
            "gaming.game_dvr" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled"),
            "performance.visual_transparency" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency"),
            "performance.background_apps" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications", "GlobalUserDisabled"),
            "privacy.advertising_id" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo", "Enabled"),
            "privacy.tailored_experiences" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "TailoredExperiencesWithDiagnosticDataEnabled"),
            "privacy.activity_history" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "ActivityHistoryEnabled"),
            "customization.show_file_extensions" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "HideFileExt"),
            "customization.show_hidden_files" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "Hidden"),
            "customization.taskbar_left_align" => ReadNullableHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAl"),
            _ => null
        };
    }

    private static void WriteSettingState(string settingId, bool enabled, int? explicitRawDword = null)
    {
        if (!OperatingSystem.IsWindows())
        {
            return;
        }

        switch (settingId)
        {
            case "gaming.game_mode":
                WriteHkcuDword(@"Software\Microsoft\GameBar", "AutoGameModeEnabled", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "gaming.game_dvr":
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\GameDVR", "AppCaptureEnabled", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "performance.visual_transparency":
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize", "EnableTransparency", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "performance.background_apps":
                // GlobalUserDisabled == 0 means background apps are enabled; 1 means disabled
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\BackgroundAccessApplications", "GlobalUserDisabled", explicitRawDword ?? (enabled ? 0 : 1));
                break;
            case "privacy.advertising_id":
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\AdvertisingInfo", "Enabled", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "privacy.tailored_experiences":
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "TailoredExperiencesWithDiagnosticDataEnabled", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "privacy.activity_history":
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Privacy", "ActivityHistoryEnabled", explicitRawDword ?? (enabled ? 1 : 0));
                break;
            case "customization.show_file_extensions":
                // Note: HideFileExt == 0 means show extensions (enabled = true); HideFileExt == 1 means hide extensions
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "HideFileExt", explicitRawDword ?? (enabled ? 0 : 1));
                break;
            case "customization.show_hidden_files":
                // Note: Hidden == 1 means show hidden files (enabled = true); Hidden == 2 means hide hidden files
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "Hidden", explicitRawDword ?? (enabled ? 1 : 2));
                break;
            case "customization.taskbar_left_align":
                // Note: TaskbarAl == 0 means left-aligned (enabled = true); TaskbarAl == 1 means center-aligned
                WriteHkcuDword(@"Software\Microsoft\Windows\CurrentVersion\Explorer\Advanced", "TaskbarAl", explicitRawDword ?? (enabled ? 0 : 1));
                break;
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
}
