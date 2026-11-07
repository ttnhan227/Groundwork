using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;

namespace Groundwork.Engine.Tests;

public sealed class ProductEvolutionEngineTests : IDisposable
{
    private readonly string _tempRoot;

    public ProductEvolutionEngineTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), $"GroundworkEvolutionTests_{Guid.NewGuid():N}");
        Directory.CreateDirectory(_tempRoot);
    }

    public void Dispose()
    {
        try
        {
            if (Directory.Exists(_tempRoot))
            {
                Directory.Delete(_tempRoot, recursive: true);
            }
        }
        catch
        {
            // Ignore cleanup errors.
        }
    }

    [Fact]
    public async Task SafeOperationEngine_Full10StepLifecycle_ExecuteVerifyAndRollback()
    {
        var historyPath = Path.Combine(_tempRoot, "history.json");
        var history = new OperationHistoryService(historyPath);
        var policy = new PolicyEngine(() => false); // Standard user
        var engine = new SafeOperationEngine(policy, history);

        var simulatedState = "Balanced";
        var descriptor = new SystemOperationDescriptor(
            OperationTypeId: "test.power_switch",
            DisplayName: "Simulated Power Switch",
            Category: "Test",
            Description: "Switches simulated state.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser,
            PotentialRisks: ["Test risk"],
            VerificationMethodDescription: "Checks simulatedState",
            RollbackMethodDescription: "Restores previous simulatedState");

        engine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: descriptor,
            ExecuteAsync: (payload, _) =>
            {
                simulatedState = payload;
                var verified = simulatedState == "HighPerformance";
                return Task.FromResult((
                    Succeeded: verified,
                    PostStateSummary: $"State is {simulatedState}",
                    StatusMessage: "Switched to HighPerformance",
                    Verification: new OperationVerificationResult(verified, simulatedState, "Verified", DateTimeOffset.UtcNow)));
            },
            RollbackAsync: (preState, _) =>
            {
                simulatedState = preState;
                var verified = simulatedState == "Balanced";
                return Task.FromResult((
                    Succeeded: verified,
                    StatusMessage: "Restored to Balanced",
                    Verification: new OperationVerificationResult(verified, simulatedState, "Restored", DateTimeOffset.UtcNow)));
            }));

        // Steps 1-6: Propose
        var proposal = engine.CreateProposal(
            descriptor: descriptor,
            targetDescription: "Power Scheme",
            inspectedCurrentStateSummary: "Currently Balanced",
            preChangeStateJson: "Balanced",
            proposedChangeExplanation: "Switch to HighPerformance",
            expectedEffects: ["Higher clocks"],
            payloadJson: "HighPerformance");

        Assert.True(proposal.PrerequisitesMet);
        Assert.NotEmpty(proposal.ConfirmationToken);

        // Steps 7-9: Execute & Verify & Record
        var record = await engine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(record.Succeeded);
        Assert.True(record.Verification.IsVerified);
        Assert.True(record.CanRollback);
        Assert.False(record.IsRolledBack);
        Assert.Equal("HighPerformance", simulatedState);

        // Single-use token cannot be reused
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            engine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));

        // History persisted
        var persisted = history.LoadRecords();
        Assert.Single(persisted);
        Assert.Equal(record.ExecutionId, persisted[0].ExecutionId);

        // Step 10: Rollback
        var rollback = await engine.RollbackOperationAsync(record.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.True(rollback.Verification.IsVerified);
        Assert.Equal("Balanced", simulatedState);

        var updatedRecord = history.GetRecordById(record.ExecutionId);
        Assert.NotNull(updatedRecord);
        Assert.True(updatedRecord!.IsRolledBack);
        Assert.False(updatedRecord.CanRollback);
    }

    [Fact]
    public void SafeOperationEngine_BlocksAdminRequiredOperationWhenNotElevated()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "admin_hist.json"));
        var policy = new PolicyEngine(() => false); // Non-elevated
        var engine = new SafeOperationEngine(policy, history);

        var adminDescriptor = new SystemOperationDescriptor(
            OperationTypeId: "test.admin_op",
            DisplayName: "Admin Operation",
            Category: "System",
            Description: "Requires admin.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.High,
            ElevationRequirement: OperationElevationRequirement.AdministratorRequired,
            PotentialRisks: ["System change"],
            VerificationMethodDescription: "Check",
            RollbackMethodDescription: "Restore");

        var proposal = engine.CreateProposal(
            descriptor: adminDescriptor,
            targetDescription: "HKLM Target",
            inspectedCurrentStateSummary: "Current",
            preChangeStateJson: "{}",
            proposedChangeExplanation: "Modify HKLM");

        Assert.False(proposal.PrerequisitesMet);
        Assert.Empty(proposal.ConfirmationToken);
        Assert.Contains("Administrator privileges", proposal.PrerequisiteFailureReason, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task SafeOperationEngine_RejectsExpiredConfirmationToken()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "exp_hist.json"));
        var engine = new SafeOperationEngine(new PolicyEngine(() => true), history);

        var descriptor = new SystemOperationDescriptor(
            OperationTypeId: "test.expire",
            DisplayName: "Expiring Op",
            Category: "Test",
            Description: "Test",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser,
            PotentialRisks: [],
            VerificationMethodDescription: "Verify",
            RollbackMethodDescription: "Rollback");

        var proposal = engine.CreateProposal(
            descriptor: descriptor,
            targetDescription: "Target",
            inspectedCurrentStateSummary: "State",
            preChangeStateJson: "{}",
            proposedChangeExplanation: "Explain",
            tokenTtl: TimeSpan.FromMilliseconds(-50));

        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            engine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken));
    }

    [Fact]
    public void PowerCfgOutputParser_ParsesActiveAndAvailableSchemesAccurately()
    {
        const string sampleOutput = """
            Existing Power Schemes (* Active)
            -----------------------------------
            Power Scheme GUID: 381b4222-f694-41f0-9685-ff5bb260df2e  (Balanced) *
            Power Scheme GUID: 8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c  (High performance)
            Power Scheme GUID: a1841308-3541-4fab-bc81-f71556f20b4a  (Power saver)
            """;

        var plans = WindowsOptimizationService.ParsePowerCfgListOutput(sampleOutput);
        Assert.Equal(3, plans.Count);

        var balanced = plans.Single(p => p.SchemeGuid == "381b4222-f694-41f0-9685-ff5bb260df2e");
        Assert.True(balanced.IsActive);
        Assert.Equal("Balanced", balanced.Name);

        var highPerf = plans.Single(p => p.SchemeGuid == "8c5e7fda-e8bf-4a96-9a85-a6e23a8c635c");
        Assert.False(highPerf.IsActive);
        Assert.Contains("responsiveness", highPerf.Description, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("latency", highPerf.PerformanceTradeoff, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public async Task StartupManagement_IsolatedFolderToggleAndRollback_WorksEndToEnd()
    {
        var activeStartupDir = Path.Combine(_tempRoot, "UserStartup");
        var disabledStartupDir = Path.Combine(_tempRoot, "DisabledStartup");
        Directory.CreateDirectory(activeStartupDir);

        var shortcutFile = Path.Combine(activeStartupDir, "DiscordUpdater.lnk");
        File.WriteAllText(shortcutFile, "dummy shortcut content");

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "startup_history.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var optService = new WindowsOptimizationService(safeEngine, activeStartupDir, disabledStartupDir);

        var initialItems = optService.InspectStartupItems();
        Assert.Single(initialItems);
        Assert.True(initialItems[0].IsEnabled);
        Assert.Equal("DiscordUpdater", initialItems[0].Name);

        // Propose & execute disable
        var disableProposal = optService.ProposeToggleStartupItem(initialItems[0].EntryId, targetEnabled: false);
        Assert.True(disableProposal.PrerequisitesMet);

        var execRecord = await safeEngine.ExecuteApprovedProposalAsync(disableProposal.ConfirmationToken);
        Assert.True(execRecord.Succeeded);
        Assert.True(execRecord.Verification.IsVerified);
        Assert.False(File.Exists(shortcutFile));

        var disabledItems = optService.InspectStartupItems();
        Assert.Single(disabledItems);
        Assert.False(disabledItems[0].IsEnabled);

        // Rollback restores startup item to active folder
        var rollback = await safeEngine.RollbackOperationAsync(execRecord.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.True(File.Exists(shortcutFile));

        var restoredItems = optService.InspectStartupItems();
        Assert.Single(restoredItems);
        Assert.True(restoredItems[0].IsEnabled);
    }

    [Fact]
    public async Task FileOrganizerService_OrganizesAndUndoesFolderCleanly()
    {
        var downloadsDir = Path.Combine(_tempRoot, "MockDownloads");
        Directory.CreateDirectory(downloadsDir);

        var pdfPath = Path.Combine(downloadsDir, "invoice.pdf");
        var pngPath = Path.Combine(downloadsDir, "screenshot.png");
        var zipPath = Path.Combine(downloadsDir, "release.zip");
        var partialPath = Path.Combine(downloadsDir, "incomplete.crdownload");

        File.WriteAllBytes(pdfPath, new byte[2048]);
        File.WriteAllBytes(pngPath, new byte[4096]);
        File.WriteAllBytes(zipPath, new byte[8192]);
        File.WriteAllBytes(partialPath, new byte[512]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "org_history.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var organizer = new FileOrganizerService(safeEngine);

        var plan = organizer.PreviewFolderOrganization(downloadsDir);
        Assert.Equal(3, plan.Candidates.Count); // .crdownload is skipped
        Assert.True(plan.CategoryCounts.ContainsKey("Documents"));
        Assert.True(plan.CategoryCounts.ContainsKey("Images"));
        Assert.True(plan.CategoryCounts.ContainsKey("Archives"));

        var proposal = organizer.ProposeOrganizeFolder(downloadsDir);
        Assert.True(proposal.PrerequisitesMet);

        var record = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(record.Succeeded);
        Assert.True(record.Verification.IsVerified);

        Assert.True(File.Exists(Path.Combine(downloadsDir, "Documents", "invoice.pdf")));
        Assert.True(File.Exists(Path.Combine(downloadsDir, "Images", "screenshot.png")));
        Assert.True(File.Exists(Path.Combine(downloadsDir, "Archives", "release.zip")));
        Assert.True(File.Exists(partialPath)); // Untouched

        // Undo / Rollback
        var undoResult = await safeEngine.RollbackOperationAsync(record.ExecutionId);
        Assert.True(undoResult.Succeeded);
        Assert.True(File.Exists(pdfPath));
        Assert.True(File.Exists(pngPath));
        Assert.True(File.Exists(zipPath));
        Assert.False(Directory.Exists(Path.Combine(downloadsDir, "Documents")));
    }

    [Fact]
    public void DpapiSecretProtector_RoundTripsAndHandlesPlaintextGracefully()
    {
        const string apiKey = "sk-test-groundwork-secret-key-998877";
        var encrypted = DpapiSecretProtector.Protect(apiKey);

        Assert.StartsWith(DpapiSecretProtector.EncryptedPrefix, encrypted);
        Assert.NotEqual(apiKey, encrypted);
        Assert.True(DpapiSecretProtector.IsEncrypted(encrypted));

        var decrypted = DpapiSecretProtector.Unprotect(encrypted);
        Assert.Equal(apiKey, decrypted);

        // Legacy plaintext is returned intact by Unprotect so existing user configs migrate seamlessly
        Assert.Equal("legacy-plain-key", DpapiSecretProtector.Unprotect("legacy-plain-key"));
    }

    [Fact]
    public async Task ToolRegistryAndAgentPlanner_ExecuteReadOnlyAndGateModifyingTools()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "agent_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var optService = new WindowsOptimizationService(safeEngine);
        var troubleService = new DiagnosticsAndTroubleshootingService(safeEngine);
        var orgService = new FileOrganizerService(safeEngine);
        var registry = new ToolRegistryService(
            optimizationService: optService,
            troubleshootingService: troubleService,
            fileOrganizerService: orgService);

        var allTools = registry.GetRegisteredTools();
        Assert.True(allTools.Count >= 14);

        // Parameter validation check
        var missingParamResult = await registry.ExecuteToolAsync(new AgentToolCallRequest("propose_switch_power_plan"));
        Assert.False(missingParamResult.Succeeded);
        Assert.Contains("Missing required parameter", missingParamResult.SummaryText);

        // Modifying tool creates a PendingProposal without silently modifying system state
        var flushProposalResult = await registry.ExecuteToolAsync(new AgentToolCallRequest("propose_flush_dns_cache"));
        Assert.True(flushProposalResult.Succeeded);
        Assert.True(flushProposalResult.IsModifyingProposal);
        Assert.NotNull(flushProposalResult.PendingProposal);
        Assert.Empty(history.LoadRecords()); // Nothing executed without explicit token approval!

        // AgentPlanner routes natural language queries and separates Confirmed Observations from Potential Causes
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);
        var turn = await planner.PlanAndInvestigateUserRequestAsync("Why is my C drive almost full?");

        Assert.Equal(InvestigationType.Storage, turn.SelectedInvestigationType);
        Assert.NotEmpty(turn.InvestigationReport.ConfirmedObservations);
        Assert.NotEmpty(turn.InvestigationReport.UnverifiedHypotheses);
        Assert.Contains("Confirmed Observations", turn.DeterministicMarkdownResponse);

        var exportedMd = InvestigationEngineService.ExportToMarkdown(turn.InvestigationReport);
        var exportedJson = InvestigationEngineService.ExportToJson(turn.InvestigationReport);
        Assert.Contains("# Storage Capacity & Disk Utilization Investigation", exportedMd);
        Assert.Contains("\"InvestigationType\"", exportedJson);
    }

    [Fact]
    public void EventLogExplainer_ProvidesAccuratePlainEnglishGuidance()
    {
        var kp41 = DiagnosticsAndTroubleshootingService.ExplainEventLogEntry("Microsoft-Windows-Kernel-Power", 41, "The system has rebooted without cleanly shutting down first.");
        Assert.Contains("cleanly shutting down", kp41);

        var dcom = DiagnosticsAndTroubleshootingService.ExplainEventLogEntry("Microsoft-Windows-DistributedCOM", 10016, "The application-specific permission settings do not grant Local Activation permission");
        Assert.Contains("Benign Windows DCOM permission warning", dcom);

        var tdr = DiagnosticsAndTroubleshootingService.ExplainEventLogEntry("Display", 4101, "Display driver nvlddmkm stopped responding");
        Assert.Contains("TDR reset", tdr);
    }

    [Fact]
    public async Task InvestigationEngine_RunsAllCoreInvestigationsAndSeparatesEvidenceCategories()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "inv_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var registry = new ToolRegistryService(
            optimizationService: new WindowsOptimizationService(safeEngine),
            troubleshootingService: new DiagnosticsAndTroubleshootingService(safeEngine),
            fileOrganizerService: new FileOrganizerService(safeEngine));
        var invEngine = new InvestigationEngineService(registry);

        foreach (var invType in new[]
        {
            InvestigationType.Performance,
            InvestigationType.Storage,
            InvestigationType.Startup,
            InvestigationType.WindowsHealth,
            InvestigationType.Hardware
        })
        {
            var report = await invEngine.RunInvestigationAsync(invType);
            Assert.Equal(invType, report.InvestigationType);
            Assert.NotEmpty(report.ExecutedTools);
            Assert.NotEmpty(report.ConfirmedObservations);
            Assert.All(report.ConfirmedObservations, f => Assert.Equal(FindingCategory.ConfirmedObservation, f.Category));
            Assert.All(report.UnverifiedHypotheses, f => Assert.Equal(FindingCategory.UnverifiedHypothesis, f.Category));
        }

        Assert.Equal(5, invEngine.GetRecentReports().Count);
    }

    [Fact]
    public async Task InvestigationEngine_HonorsCancellationToken()
    {
        var invEngine = new InvestigationEngineService();
        using var cts = new CancellationTokenSource();
        cts.Cancel();

        await Assert.ThrowsAnyAsync<OperationCanceledException>(() =>
            invEngine.RunInvestigationAsync(InvestigationType.Performance, cancellationToken: cts.Token));
    }

    [Fact]
    public void DiagnosticsAndTroubleshootingService_InspectsProcessesServicesAndRepairStatus()
    {
        var svc = new DiagnosticsAndTroubleshootingService();

        var procs = svc.InspectProcesses(5);
        Assert.True(procs.TotalProcessCount > 0);
        Assert.NotEmpty(procs.TopMemoryProcesses);
        Assert.True(procs.TopMemoryProcesses.Count <= 5);

        var services = svc.InspectKeyWindowsServices();
        Assert.NotEmpty(services);
        Assert.Contains(services, s => s.ServiceName.Equals("EventLog", StringComparison.OrdinalIgnoreCase));

        var repair = svc.InspectWindowsRepairAndHealthStatus();
        Assert.Contains("sfc /scannow", repair.SfcGuidance, StringComparison.OrdinalIgnoreCase);
        Assert.Contains("DISM", repair.DismGuidance, StringComparison.OrdinalIgnoreCase);
    }

    [Fact]
    public void ScheduledTaskXmlParser_IdentifiesLogonTasksAndIgnoresNonStartupTasks()
    {
        const string logonTaskXml = """
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo>
                <Author>AcmeUpdaterCorp</Author>
              </RegistrationInfo>
              <Triggers>
                <LogonTrigger>
                  <Enabled>true</Enabled>
                </LogonTrigger>
              </Triggers>
              <Settings>
                <Enabled>true</Enabled>
              </Settings>
              <Actions Context="Author">
                <Exec>
                  <Command>"C:\Program Files\Acme\AcmeDaemon.exe"</Command>
                  <Arguments>--background</Arguments>
                </Exec>
              </Actions>
            </Task>
            """;

        var entry = WindowsOptimizationService.ParseScheduledTaskXml(@"\Acme\AcmeAutoLogon", logonTaskXml);
        Assert.NotNull(entry);
        Assert.Equal(StartupEntryScope.ScheduledStartupTask, entry!.Scope);
        Assert.Equal(@"ScheduledStartupTask:\Acme\AcmeAutoLogon", entry.EntryId);
        Assert.True(entry.IsEnabled);
        Assert.Equal("AcmeUpdaterCorp", entry.Publisher);
        Assert.Contains("Task Scheduler", entry.ImpactReason);

        const string calendarOnlyXml = """
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <Triggers>
                <CalendarTrigger />
              </Triggers>
              <Actions Context="Author">
                <Exec>
                  <Command>C:\Tools\backup.exe</Command>
                </Exec>
              </Actions>
            </Task>
            """;

        Assert.Null(WindowsOptimizationService.ParseScheduledTaskXml(@"\Acme\WeeklyBackup", calendarOnlyXml));
    }

    [Fact]
    public async Task DnsProviderSwitch_ProposesExecutesVerifiesAndRollsBackCleanly()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "dns_hist.json"));
        // Simulate elevated administrator session so DNS switching prerequisites pass
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);

        var currentDns = new List<string> { "192.168.1.1" };
        var isDhcp = true;
        var netshCommands = new List<string>();

        var troubleService = new DiagnosticsAndTroubleshootingService(
            safeEngine,
            customNetshRunner: args =>
            {
                var joined = string.Join(" ", args);
                netshCommands.Add(joined);
                if (joined.Contains("source=dhcp", StringComparison.OrdinalIgnoreCase))
                {
                    isDhcp = true;
                    currentDns = ["192.168.1.1"];
                }
                else if (joined.Contains("source=static", StringComparison.OrdinalIgnoreCase))
                {
                    isDhcp = false;
                    var addrArg = args.FirstOrDefault(a => a.StartsWith("address=", StringComparison.OrdinalIgnoreCase));
                    currentDns = addrArg is not null ? [addrArg["address=".Length..]] : [];
                }
                else if (joined.Contains("add dnsservers", StringComparison.OrdinalIgnoreCase))
                {
                    var addrArg = args.FirstOrDefault(a => a.StartsWith("address=", StringComparison.OrdinalIgnoreCase));
                    if (addrArg is not null)
                    {
                        currentDns.Add(addrArg["address=".Length..]);
                    }
                }
                return (0, "Ok.");
            },
            customInterfaceInspector: () =>
            [
                new NetworkInterfaceDiagnostic(
                    Name: "Ethernet",
                    Description: "Intel Ethernet Controller",
                    InterfaceType: "Ethernet",
                    OperationalStatus: "Up",
                    SpeedBitsPerSecond: 1_000_000_000,
                    IpAddresses: ["192.168.1.50"],
                    GatewayAddresses: ["192.168.1.1"],
                    DnsServers: currentDns.ToList(),
                    IsDhcpEnabled: isDhcp)
            ]);

        var proposal = troubleService.ProposeSwitchDnsProvider("Cloudflare");
        Assert.True(proposal.PrerequisitesMet);
        Assert.Contains("1.1.1.1", proposal.ProposedChangeExplanation);

        var execRecord = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(execRecord.Succeeded);
        Assert.True(execRecord.Verification.IsVerified);
        Assert.Contains("1.1.1.1", currentDns);
        Assert.Contains("1.0.0.1", currentDns);

        var rollback = await safeEngine.RollbackOperationAsync(execRecord.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.True(isDhcp);
        Assert.Equal(["192.168.1.1"], currentDns);
    }

    [Fact]
    public async Task SafeTempAndBrowserCacheCleanup_InspectsAndCleansClosedBrowserCaches()
    {
        var mockTemp = Path.Combine(_tempRoot, "MockUserTemp");
        var mockLocalApp = Path.Combine(_tempRoot, "MockLocalAppData");
        var edgeCacheDir = Path.Combine(mockLocalApp, "Microsoft", "Edge", "User Data", "Default", "Cache", "Cache_Data");
        var crashDumpsDir = Path.Combine(mockLocalApp, "CrashDumps");

        Directory.CreateDirectory(mockTemp);
        Directory.CreateDirectory(edgeCacheDir);
        Directory.CreateDirectory(crashDumpsDir);

        File.WriteAllBytes(Path.Combine(mockTemp, "scratch1.tmp"), new byte[4096]);
        File.WriteAllBytes(Path.Combine(edgeCacheDir, "f_00001a"), new byte[8192]);
        File.WriteAllBytes(Path.Combine(crashDumpsDir, "app.exe.1234.dmp"), new byte[2048]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "cleanup_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var troubleService = new DiagnosticsAndTroubleshootingService(
            safeEngine,
            customTempDir: mockTemp,
            customLocalAppDataDir: mockLocalApp);

        var summary = troubleService.InspectSafeTempAndBrowserCaches();
        Assert.Equal(1, summary.UserTempFileCount);
        Assert.Equal(1, summary.CrashDumpFileCount);
        Assert.Single(summary.BrowserCaches);
        Assert.False(summary.BrowserCaches[0].IsBrowserProcessRunning);
        Assert.Equal(4096 + 8192 + 2048, summary.TotalSafeReclaimableBytes);

        var proposal = troubleService.ProposeSafeTempAndCacheCleanup(includeClosedBrowserCaches: true);
        Assert.True(proposal.PrerequisitesMet);

        var record = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(record.Succeeded);
        Assert.True(record.Verification.IsVerified);

        var afterSummary = troubleService.InspectSafeTempAndBrowserCaches();
        Assert.Equal(0, afterSummary.TotalSafeFileCount);
    }

    [Fact]
    public async Task AgentPlanner_HandlesDnsSwitchAndCleanupAndStartupQueriesWithProposals()
    {
        var mockTemp = Path.Combine(_tempRoot, "AgentTemp");
        Directory.CreateDirectory(mockTemp);
        File.WriteAllBytes(Path.Combine(mockTemp, "stale.tmp"), new byte[1024]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "agent_exp_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var optService = new WindowsOptimizationService(safeEngine);
        var troubleService = new DiagnosticsAndTroubleshootingService(
            safeEngine,
            customTempDir: mockTemp,
            customLocalAppDataDir: Path.Combine(_tempRoot, "AgentLocalApp"));
        var registry = new ToolRegistryService(
            optimizationService: optService,
            troubleshootingService: troubleService,
            fileOrganizerService: new FileOrganizerService(safeEngine));
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);

        // 1. "Switch my DNS to Cloudflare"
        var dnsTurn = await planner.PlanAndInvestigateUserRequestAsync("Switch my DNS to Cloudflare");
        Assert.Equal(InvestigationType.Network, dnsTurn.SelectedInvestigationType);
        Assert.Contains(dnsTurn.PendingApprovalProposals, p => p.OperationTypeId == DiagnosticsAndTroubleshootingService.SwitchDnsOperationId);

        // 2. "Clean unnecessary files"
        var cleanTurn = await planner.PlanAndInvestigateUserRequestAsync("Clean unnecessary files");
        Assert.Equal(InvestigationType.Storage, cleanTurn.SelectedInvestigationType);
        Assert.Contains(cleanTurn.PendingApprovalProposals, p => p.OperationTypeId == DiagnosticsAndTroubleshootingService.SafeTempAndCacheCleanupOperationId);

        // 3. DISM output parser verification
        var (healthy, msg) = DiagnosticsAndTroubleshootingService.ParseDismCheckHealthOutput(
            "Deployment Image Servicing and Management tool\r\nNo component store corruption detected.\r\nThe operation completed successfully.");
        Assert.True(healthy);
        Assert.Contains("No component store corruption detected", msg);
    }
}
