using System;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Microsoft.Win32;
using Xunit;

namespace Groundwork.Engine.Tests;

public sealed class PowerTweaksAndRepairTests : IDisposable
{
    private readonly string _testRegPrefix = $@"Software\GroundworkTests\{Guid.NewGuid():N}";

    public void Dispose()
    {
        if (!OperatingSystem.IsWindows()) return;
        try
        {
            Registry.CurrentUser.DeleteSubKeyTree(_testRegPrefix, throwOnMissingSubKey: false);
        }
        catch
        {
            // Best effort test registry cleanup
        }
    }

    [Fact]
    public async Task ClassicContextMenu_And_DebloatTweaks_ExecuteAndRollbackCleanly()
    {
        if (!OperatingSystem.IsWindows()) return;

        var safeOps = new SafeOperationEngine();
        var svc = new WindowsOptimizationService(safeOps, customHkcuSettingsPrefix: _testRegPrefix);

        var initial = svc.InspectConfigurableSettings();
        Assert.Contains(initial, s => s.SettingId == "customization.classic_context_menu" && !s.IsEnabled);
        Assert.Contains(initial, s => s.SettingId == "debloat.disable_bing_search" && !s.IsEnabled);
        Assert.Contains(initial, s => s.SettingId == "customization.taskbar_end_task" && !s.IsEnabled);
        Assert.Contains(initial, s => s.SettingId == "debloat.disable_start_ads" && !s.IsEnabled);

        // 1. Toggle Classic Right-Click Context Menu ON -> verifies registry CLSID exists -> rollback deletes it
        var ctxProposal = svc.ProposeToggleSetting("customization.classic_context_menu", true);
        Assert.True(ctxProposal.PrerequisitesMet);
        var ctxExec = await safeOps.ExecuteApprovedProposalAsync(ctxProposal.ConfirmationToken);
        Assert.True(ctxExec.Succeeded);
        Assert.True(svc.InspectConfigurableSettings().First(s => s.SettingId == "customization.classic_context_menu").IsEnabled);

        var ctxRollback = await safeOps.RollbackOperationAsync(ctxExec.ExecutionId);
        Assert.True(ctxRollback.Succeeded);
        Assert.False(svc.InspectConfigurableSettings().First(s => s.SettingId == "customization.classic_context_menu").IsEnabled);

        // 2. Toggle Disable Bing Search ON (writes primary + companion HKCU Search key) -> rollback removes both
        var bingProposal = svc.ProposeToggleSetting("debloat.disable_bing_search", true);
        Assert.True(bingProposal.PrerequisitesMet);
        var bingExec = await safeOps.ExecuteApprovedProposalAsync(bingProposal.ConfirmationToken);
        Assert.True(bingExec.Succeeded);
        Assert.True(svc.InspectConfigurableSettings().First(s => s.SettingId == "debloat.disable_bing_search").IsEnabled);

        using (var searchKey = Registry.CurrentUser.OpenSubKey($@"{_testRegPrefix}\Software\Microsoft\Windows\CurrentVersion\Search"))
        {
            Assert.NotNull(searchKey);
            Assert.Equal(0, Convert.ToInt32(searchKey!.GetValue("BingSearchEnabled")));
        }

        var bingRollback = await safeOps.RollbackOperationAsync(bingExec.ExecutionId);
        Assert.True(bingRollback.Succeeded);
        Assert.False(svc.InspectConfigurableSettings().First(s => s.SettingId == "debloat.disable_bing_search").IsEnabled);
    }

    [Fact]
    public void AppxParser_ProtectsCoreStorePackages_AndHighlightsBloatware()
    {
        const string sampleJson = """
        [
          {"Name":"Microsoft.WindowsStore","PackageFullName":"Microsoft.WindowsStore_22408.1401.0.0_x64__8wekyb3d8bbwe","Publisher":"CN=Microsoft Corporation","Version":"22408.1401.0.0","IsFramework":false,"NonRemovable":false},
          {"Name":"Microsoft.BingWeather","PackageFullName":"Microsoft.BingWeather_4.53.52331.0_x64__8wekyb3d8bbwe","Publisher":"CN=Microsoft Corporation","Version":"4.53.52331.0","IsFramework":false,"NonRemovable":false},
          {"Name":"Clipchamp.Clipchamp","PackageFullName":"Clipchamp.Clipchamp_3.1.0.0_neutral__yxz26nhyzhsrt","Publisher":"CN=Clipchamp","Version":"3.1.0.0","IsFramework":false,"NonRemovable":false},
          {"Name":"Microsoft.UI.Xaml.2.8","PackageFullName":"Microsoft.UI.Xaml.2.8_8.2310.30001.0_x64__8wekyb3d8bbwe","Publisher":"CN=Microsoft Corporation","Version":"8.2310.30001.0","IsFramework":true,"NonRemovable":false}
        ]
        """;

        var parsed = WindowsRepairAndDebloatService.ParseAppxPackagesJson(sampleJson);
        Assert.Equal(3, parsed.Count); // Framework package filtered out

        var store = parsed.Single(p => p.Name == "Microsoft.WindowsStore");
        Assert.True(store.IsProtectedSystemPackage);
        Assert.False(store.IsSuggestedBloat);

        var weather = parsed.Single(p => p.Name == "Microsoft.BingWeather");
        Assert.False(weather.IsProtectedSystemPackage);
        Assert.True(weather.IsSuggestedBloat);

        var svc = new WindowsRepairAndDebloatService();
        var blockedProposal = svc.ProposeRemoveAppxPackage(store.PackageFullName, store.Name);
        Assert.False(blockedProposal.PrerequisitesMet);

        var allowedProposal = svc.ProposeRemoveAppxPackage(weather.PackageFullName, weather.Name);
        Assert.True(allowedProposal.PrerequisitesMet);
    }

    [Fact]
    public async Task RepairWorkflow_EnforcesAdminPrivileges_AndExecutesMockedNetworkReset()
    {
        var calls = new List<string>();
        var standardSafeOps = new SafeOperationEngine(new PolicyEngine(() => false));
        var standardSvc = new WindowsRepairAndDebloatService(
            standardSafeOps,
            isElevatedFunc: () => false,
            processRunner: (file, args, _) =>
            {
                calls.Add($"{file} {string.Join(" ", args)}");
                return (0, "OK");
            });

        // Admin-required repair rejected when standard user
        var netBlocked = standardSvc.ProposeRepairAction("repair.network_reset");
        Assert.False(netBlocked.PrerequisitesMet);
        Assert.Contains("Administrator", netBlocked.PrerequisiteFailureReason, StringComparison.OrdinalIgnoreCase);

        // Standard-user repair allowed
        var iconAllowed = standardSvc.ProposeRepairAction("repair.explorer_icon_cache");
        Assert.True(iconAllowed.PrerequisitesMet);

        // Elevated repair succeeds & invokes deterministic commands
        var adminSafeOps = new SafeOperationEngine(new PolicyEngine(() => true));
        var adminSvc = new WindowsRepairAndDebloatService(
            adminSafeOps,
            isElevatedFunc: () => true,
            processRunner: (file, args, _) =>
            {
                calls.Add($"{file} {string.Join(" ", args)}");
                return (0, "Sucessfully reset");
            });

        var netProposal = adminSvc.ProposeRepairAction("repair.network_reset");
        Assert.True(netProposal.PrerequisitesMet);
        var exec = await adminSafeOps.ExecuteApprovedProposalAsync(netProposal.ConfirmationToken);
        Assert.True(exec.Succeeded);
        Assert.Contains(calls, c => c.Contains("ipconfig.exe /flushdns", StringComparison.OrdinalIgnoreCase));
        Assert.Contains(calls, c => c.Contains("netsh.exe winsock reset", StringComparison.OrdinalIgnoreCase));
    }

    [Fact]
    public async Task EssentialTools_And_ToolRegistry_ExposeRuntimeAndRepairTools()
    {
        var safeOps = new SafeOperationEngine(new PolicyEngine(() => true));
        var installedWingetIds = new List<string>();
        var repairSvc = new WindowsRepairAndDebloatService(
            safeOps,
            isElevatedFunc: () => true,
            processRunner: (file, args, _) =>
            {
                installedWingetIds.Add($"{file} {string.Join(" ", args)}");
                if (file.Equals("winget.exe", StringComparison.OrdinalIgnoreCase) && args.Contains("list"))
                {
                    return (0, "Everything voidtools.Everything 1.4.1.1026");
                }
                return (0, "Successfully installed");
            },
            customRuntimeInspector: () =>
            [
                new RuntimeHealthEntry("runtime.vcredist_x64", "Visual C++ 2015–2022 (x64)", false, "Missing", "Missing", "Microsoft.VCRedist.2015+.x64"),
                new RuntimeHealthEntry("runtime.vcredist_x86", "Visual C++ 2015–2022 (x86)", true, "14.40", "Installed", null)
            ]);

        var tools = repairSvc.InspectEssentialTools();
        Assert.Contains(tools, t => t.WingetId == "Microsoft.VCRedist.2015+.x64" && !t.IsDetectedInstalled);
        Assert.Contains(tools, t => t.WingetId == "voidtools.Everything" && t.IsDetectedInstalled);
        Assert.Contains(tools, t => t.WingetId == "7zip.7zip");

        var unknownProposal = repairSvc.ProposeInstallEssentialTool("arbitrary.unapproved.pkg");
        Assert.False(unknownProposal.PrerequisitesMet);

        var vcProposal = repairSvc.ProposeInstallEssentialTool("Microsoft.VCRedist.2015+.x64");
        Assert.True(vcProposal.PrerequisitesMet);
        var vcExec = await safeOps.ExecuteApprovedProposalAsync(vcProposal.ConfirmationToken);
        Assert.True(vcExec.Succeeded);
        Assert.Contains(installedWingetIds, c => c.Contains("Microsoft.VCRedist.2015+.x64"));

        var registry = new ToolRegistryService(repairAndDebloatService: repairSvc);
        var runtimeToolRes = await registry.ExecuteToolAsync(new AgentToolCallRequest("inspect_runtime_health"));
        Assert.True(runtimeToolRes.Succeeded);
        Assert.Contains("Missing runtime(s)", runtimeToolRes.SummaryText);

        var repairToolRes = await registry.ExecuteToolAsync(new AgentToolCallRequest(
            "propose_repair_workflow",
            new Dictionary<string, string> { ["repair_id"] = "repair.print_spooler" }));
        Assert.True(repairToolRes.Succeeded);
        Assert.NotNull(repairToolRes.PendingProposal);
    }

    [Fact]
    public async Task UnlockUltimatePerformance_DeletesCreatedDuplicateSchemeOnRollback()
    {
        var activeGuid = "381b4222-f694-41f0-9685-ff5bb260df2e";
        var createdGuid = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
        var hasUltimate = false;
        var powerCalls = new List<string>();

        string MockPowerCfg(IReadOnlyList<string> args)
        {
            var joined = string.Join(" ", args);
            powerCalls.Add(joined);
            if (joined == "/list")
            {
                var lines = new List<string>
                {
                    $"Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced){(activeGuid.StartsWith("381b") ? " *" : "")}"
                };
                if (hasUltimate)
                {
                    lines.Add($"Power Scheme GUID: {createdGuid}  (Ultimate Performance){(activeGuid == createdGuid ? " *" : "")}");
                }
                return string.Join(Environment.NewLine, lines);
            }
            if (joined.StartsWith("/duplicatescheme", StringComparison.OrdinalIgnoreCase))
            {
                hasUltimate = true;
                return $"Power Scheme GUID: {createdGuid}  (Ultimate Performance)";
            }
            if (args.Count >= 2 && args[0] == "/setactive")
            {
                activeGuid = args[1];
                return string.Empty;
            }
            if (args.Count >= 2 && args[0] == "/delete" && args[1].Equals(createdGuid, StringComparison.OrdinalIgnoreCase))
            {
                hasUltimate = false;
                return string.Empty;
            }
            return string.Empty;
        }

        var safeOps = new SafeOperationEngine();
        var svc = new WindowsOptimizationService(safeOps, customPowerCfgRunner: MockPowerCfg);

        var proposal = svc.ProposeUnlockUltimatePerformancePlan();
        Assert.True(proposal.PrerequisitesMet);
        var exec = await safeOps.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);
        Assert.True(hasUltimate);
        Assert.Equal(createdGuid, activeGuid);

        var rollback = await safeOps.RollbackOperationAsync(exec.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.False(hasUltimate);
        Assert.Equal("381b4222-f694-41f0-9685-ff5bb260df2e", activeGuid);
        Assert.Contains(powerCalls, c => c == $"/delete {createdGuid}");
    }

    [Fact]
    public void ProposeEmptyRecycleBin_RegistersHandledProposal()
    {
        var safeOps = new SafeOperationEngine();
        var hotspots = new StorageHotspotAnalyzerService(safeOps);
        var proposal = hotspots.ProposeEmptyRecycleBin();
        Assert.Equal(StorageHotspotAnalyzerService.EmptyRecycleBinOperationId, proposal.OperationTypeId);
        Assert.True(proposal.PrerequisitesMet);
    }

    [Fact]
    public async Task BatchTweakPreset_And_RawMouseToggle_ApplyAndRollbackAllSettings()
    {
        if (!OperatingSystem.IsWindows()) return;

        var safeOps = new SafeOperationEngine();
        var svc = new WindowsOptimizationService(safeOps, customHkcuSettingsPrefix: _testRegPrefix);

        // Seed non-default prior values for mouse & game mode to verify lossless rollback
        using (var mouseKey = Registry.CurrentUser.CreateSubKey($@"{_testRegPrefix}\Control Panel\Mouse"))
        {
            mouseKey?.SetValue("MouseSpeed", "1", RegistryValueKind.String);
            mouseKey?.SetValue("MouseThreshold1", "6", RegistryValueKind.String);
            mouseKey?.SetValue("MouseThreshold2", "10", RegistryValueKind.String);
        }

        var presetProposal = svc.ProposeApplyTweakPreset("Gaming & Raw Mouse", WindowsOptimizationService.GamingLatencyPreset);
        Assert.True(presetProposal.PrerequisitesMet);

        var exec = await safeOps.ExecuteApprovedProposalAsync(presetProposal.ConfirmationToken);
        Assert.True(exec.Succeeded);

        var afterApply = svc.InspectConfigurableSettings();
        Assert.True(afterApply.First(s => s.SettingId == "customization.disable_mouse_accel").IsEnabled);
        Assert.True(afterApply.First(s => s.SettingId == "gaming.game_mode").IsEnabled);
        Assert.False(afterApply.First(s => s.SettingId == "gaming.game_dvr").IsEnabled);
        Assert.False(afterApply.First(s => s.SettingId == "performance.background_apps").IsEnabled);

        var rollback = await safeOps.RollbackOperationAsync(exec.ExecutionId);
        Assert.True(rollback.Succeeded);

        var afterRollback = svc.InspectConfigurableSettings();
        Assert.False(afterRollback.First(s => s.SettingId == "customization.disable_mouse_accel").IsEnabled);
        using (var mouseKey = Registry.CurrentUser.OpenSubKey($@"{_testRegPrefix}\Control Panel\Mouse"))
        {
            Assert.Equal("1", mouseKey?.GetValue("MouseSpeed")?.ToString());
        }
    }

    [Fact]
    public async Task BatchWingetInstall_And_HibernationGate_BehaveCorrectly()
    {
        var commands = new List<string>();
        var safeOps = new SafeOperationEngine(new PolicyEngine(() => true));
        var repairSvc = new WindowsRepairAndDebloatService(
            safeOps,
            isElevatedFunc: () => true,
            processRunner: (file, args, _) =>
            {
                commands.Add($"{file} {string.Join(" ", args)}");
                return (0, "Successfully installed");
            });

        var emptyBatch = repairSvc.ProposeInstallEssentialToolsBatch(["not.in.catalog"]);
        Assert.False(emptyBatch.PrerequisitesMet);

        var validBatch = repairSvc.ProposeInstallEssentialToolsBatch(["7zip.7zip", "voidtools.Everything"]);
        Assert.True(validBatch.PrerequisitesMet);
        var batchExec = await safeOps.ExecuteApprovedProposalAsync(validBatch.ConfirmationToken);
        Assert.True(batchExec.Succeeded);
        Assert.Contains(commands, c => c.Contains("7zip.7zip"));
        Assert.Contains(commands, c => c.Contains("voidtools.Everything"));

        var stdOpt = new WindowsOptimizationService(new SafeOperationEngine(new PolicyEngine(() => false)));
        var hiberDenied = stdOpt.ProposeToggleHibernation(false);
        Assert.False(hiberDenied.PrerequisitesMet);

        var adminOpt = new WindowsOptimizationService(new SafeOperationEngine(new PolicyEngine(() => true)));
        var hiberAllowed = adminOpt.ProposeToggleHibernation(false);
        Assert.True(hiberAllowed.PrerequisitesMet);
    }

    [Fact]
    public async Task BatchRemoveAppx_And_RegistryLeftoverCleaner_EnforceSafetyBoundaries()
    {
        var psCalls = new List<string>();
        var safeOps = new SafeOperationEngine();
        var svc = new WindowsRepairAndDebloatService(
            safeOps,
            isElevatedFunc: () => false,
            processRunner: (file, args, _) =>
            {
                psCalls.Add($"{file} {string.Join(" ", args)}");
                return (0, "Removed");
            });

        var packages = new List<AppxPackageEntry>
        {
            new("Microsoft.WindowsStore", "Microsoft.WindowsStore_1.0_x64__8wekyb3d8bbwe", "Microsoft", "1.0", "Protected System", "", true, false),
            new("Microsoft.BingWeather", "Microsoft.BingWeather_1.0_x64__8wekyb3d8bbwe", "Microsoft", "1.0", "Suggested Bloatware", "", false, true)
        };

        var proposal = svc.ProposeRemoveAppxPackagesBatch(packages);
        Assert.True(proposal.PrerequisitesMet);
        Assert.DoesNotContain("WindowsStore", proposal.TargetDescription, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("BingWeather", proposal.TargetDescription, StringComparison.OrdinalIgnoreCase);

        var exec = await safeOps.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);
        Assert.Single(psCalls);

        Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Microsoft\Windows\CurrentVersion\Run"));
        Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Groundwork"));
        Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\GroundworkTests\DummyLeftoverApp"));

        if (OperatingSystem.IsWindows())
        {
            var dummySubKey = $@"Software\GroundworkTests\Leftover_{Guid.NewGuid():N}";
            using (var created = Registry.CurrentUser.CreateSubKey(dummySubKey))
            {
                created?.SetValue("Sample", "1");
            }

            var regProposal = svc.ProposeCleanLeftoverRegistryKeys([@"HKCU\" + dummySubKey, @"HKCU\Software\Microsoft\Windows"]);
            Assert.True(regProposal.PrerequisitesMet);
            var regExec = await safeOps.ExecuteApprovedProposalAsync(regProposal.ConfirmationToken);
            Assert.True(regExec.Succeeded);

            using var check = Registry.CurrentUser.OpenSubKey(dummySubKey);
            Assert.Null(check);
        }
    }

    [Fact]
    public async Task ScanAppLeftovers_RespectsScanDepths_And_SafeValueDeletion()
    {
        var tempRoot = Path.Combine(Path.GetTempPath(), $"GroundworkScanDepthTest_{Guid.NewGuid():N}");
        var appDataDir = Path.Combine(tempRoot, "AppDataLocal");
        var commonFilesDir = Path.Combine(tempRoot, "CommonFiles");
        Directory.CreateDirectory(Path.Combine(appDataDir, "SampleApp"));
        Directory.CreateDirectory(Path.Combine(appDataDir, "SampleAppHelperLogs"));
        Directory.CreateDirectory(Path.Combine(commonFilesDir, "VendorName", "SampleApp"));

        try
        {
            var svc = new InstalledAppsEngineService();

            var safeReport = svc.ScanAppLeftovers(
                "reg:HKCU:SampleApp",
                "SampleApp",
                "VendorName",
                customSearchRoots: [("AppData (Local)", appDataDir), ("Common Files", commonFilesDir)],
                includeInstallLocation: false,
                scanDepth: LeftoverScanDepth.Safe);
            Assert.Contains(safeReport.FileSystemLeftovers, f => f.Name == "SampleApp" && f.LocationGroup == "AppData (Local)");
            Assert.DoesNotContain(safeReport.FileSystemLeftovers, f => f.Name == "SampleAppHelperLogs");

            var advReport = svc.ScanAppLeftovers(
                "reg:HKCU:SampleApp",
                "SampleApp",
                "VendorName",
                customSearchRoots: [("AppData (Local)", appDataDir), ("Common Files", commonFilesDir)],
                includeInstallLocation: false,
                scanDepth: LeftoverScanDepth.Advanced);
            Assert.Contains(advReport.FileSystemLeftovers, f => f.Name == "SampleAppHelperLogs");
            Assert.Contains(advReport.FileSystemLeftovers, f => f.FullPath.Contains("CommonFiles", StringComparison.OrdinalIgnoreCase));

            // Boundary rules for Advanced Registry sweeps: allow leaf Uninstall/App Paths/::Value, block parent keys
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKLM\Software\Microsoft\Windows\CurrentVersion\Uninstall"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKLM\SYSTEM\CurrentControlSet\Services\Dnscache"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Classes"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Classes\.txt"));
            Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\SampleApp"));
            Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Microsoft\Windows\CurrentVersion\Run::SampleAppAutoStart"));
            Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Classes\sampleappurl"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Microsoft"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\VendorOnly"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKLM\Software\WOW6432Node"));
            Assert.False(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKLM\Software\WOW6432Node\VendorOnly"));
            Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKCU\Software\Vendor\SampleApp"));
            Assert.True(WindowsRepairAndDebloatService.IsSafeLeftoverRegistryKey(@"HKLM\Software\WOW6432Node\Vendor\SampleApp"));

            if (OperatingSystem.IsWindows())
            {
                const string runSub = @"Software\Microsoft\Windows\CurrentVersion\Run";
                string valName = $"GroundworkTestVal_{Guid.NewGuid():N}";
                using (var runKey = Registry.CurrentUser.CreateSubKey(runSub))
                {
                    runKey?.SetValue(valName, @"C:\Temp\Fake.exe", RegistryValueKind.String);
                }

                var safeOps = new SafeOperationEngine();
                var repairSvc = new WindowsRepairAndDebloatService(safeOps, isElevatedFunc: () => false);
                var prop = repairSvc.ProposeCleanLeftoverRegistryKeys([$@"HKCU\{runSub}::{valName}"]);
                Assert.True(prop.PrerequisitesMet);
                var exec = await safeOps.ExecuteApprovedProposalAsync(prop.ConfirmationToken);
                Assert.True(exec.Succeeded);

                using var check = Registry.CurrentUser.OpenSubKey(runSub);
                Assert.NotNull(check); // Parent Run key MUST stay intact!
                Assert.Null(check.GetValue(valName)); // Only the single value was deleted
            }
        }
        finally
        {
            try { Directory.Delete(tempRoot, recursive: true); } catch { }
        }
    }
}
