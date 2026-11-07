using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;

namespace Groundwork.Engine.Tests;

public sealed class OperationalVerificationEngineTests : IDisposable
{
    private readonly string _tempRoot;

    public OperationalVerificationEngineTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), $"GroundworkVerificationTests_{Guid.NewGuid():N}");
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
            // Ignore temporary cleanup errors.
        }
    }

    // =========================================================================
    // 1. SCHEDULED TASK MANAGEMENT & RESTORATION
    // =========================================================================

    [Fact]
    public void ScheduledTask_XmlParser_ValidatesTriggerAndStateAccurately()
    {
        var sampleXml = """
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <RegistrationInfo>
                <Author>TestPublisher</Author>
                <Description>Background Helper Task</Description>
              </RegistrationInfo>
              <Triggers>
                <LogonTrigger>
                  <Enabled>true</Enabled>
                </LogonTrigger>
              </Triggers>
              <Actions Context="Author">
                <Exec>
                  <Command>C:\Program Files\TestApp\Helper.exe</Command>
                  <Arguments>--autostart</Arguments>
                </Exec>
              </Actions>
            </Task>
            """;

        var task = WindowsOptimizationService.ParseScheduledTaskXml(@"\TestApp\HelperTask", sampleXml);
        Assert.NotNull(task);
        Assert.Equal(StartupEntryScope.ScheduledStartupTask, task!.Scope);
        Assert.Equal(@"ScheduledStartupTask:\TestApp\HelperTask", task.EntryId);
        Assert.Equal(@"TestApp\HelperTask", task.Name);
        Assert.Equal("TestPublisher", task.Publisher);
        Assert.Equal(@"C:\Program Files\TestApp\Helper.exe", task.ExecutablePath);
        Assert.True(task.IsEnabled);

        // Non-startup task (e.g. daily calendar cron without logon trigger) must be ignored
        var nonStartupXml = """
            <?xml version="1.0" encoding="UTF-16"?>
            <Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
              <Triggers>
                <CalendarTrigger>
                  <StartBoundary>2026-01-01T03:00:00</StartBoundary>
                </CalendarTrigger>
              </Triggers>
              <Actions Context="Author">
                <Exec>
                  <Command>C:\Windows\System32\certutil.exe</Command>
                </Exec>
              </Actions>
            </Task>
            """;
        var nonStartup = WindowsOptimizationService.ParseScheduledTaskXml(@"\System\CertSync", nonStartupXml);
        Assert.Null(nonStartup);
    }

    [Fact]
    public async Task ScheduledTask_ProposeDisableAndRollback_LifecycleVerification()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "task_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);

        var taskState = "Enabled";
        var taskDescriptor = new SystemOperationDescriptor(
            OperationTypeId: WindowsOptimizationService.StartupToggleOperationId,
            DisplayName: "Toggle Scheduled Startup Task",
            Category: "Optimize / Startup Management",
            Description: "Simulated toggle of a logon scheduled task.",
            Reversibility: OperationReversibility.Reversible,
            RiskLevel: OperationRiskLevel.Low,
            ElevationRequirement: OperationElevationRequirement.StandardUser,
            PotentialRisks: ["Simulated task toggle"],
            VerificationMethodDescription: "Checks task state",
            RollbackMethodDescription: "Restores task state");

        safeEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: taskDescriptor,
            ExecuteAsync: (payload, _) =>
            {
                taskState = payload;
                var verified = taskState == "Disabled";
                return Task.FromResult((
                    Succeeded: verified,
                    PostStateSummary: $"Task is {taskState}",
                    StatusMessage: $"Switched task state to {taskState}",
                    Verification: new OperationVerificationResult(verified, taskState, "Verified", DateTimeOffset.UtcNow)));
            },
            RollbackAsync: (preState, _) =>
            {
                taskState = preState;
                var verified = taskState == "Enabled";
                return Task.FromResult((
                    Succeeded: verified,
                    StatusMessage: $"Restored task state to {taskState}",
                    Verification: new OperationVerificationResult(verified, taskState, "Restored", DateTimeOffset.UtcNow)));
            }));

        var proposal = safeEngine.CreateProposal(
            descriptor: taskDescriptor,
            targetDescription: @"ScheduledTask:\Vendor\BackgroundSync",
            inspectedCurrentStateSummary: "Currently Enabled",
            preChangeStateJson: "Enabled",
            proposedChangeExplanation: "Disable scheduled startup task",
            expectedEffects: ["Task will not launch at user logon"],
            payloadJson: "Disabled");

        Assert.True(proposal.PrerequisitesMet);
        var execRecord = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(execRecord.Succeeded);
        Assert.Equal("Disabled", taskState);
        Assert.True(execRecord.CanRollback);

        var rollback = await safeEngine.RollbackOperationAsync(execRecord.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.Equal("Enabled", taskState);
    }

    // =========================================================================
    // 2. DNS SWITCHING & DHCP/ORIGINAL RESTORATION
    // =========================================================================

    [Fact]
    public async Task DnsSwitching_SwitchToStaticCloudflare_AndRollbackToDhcp()
    {
        var invokedNetshCommands = new List<string>();
        (int ExitCode, string Output) NetshMock(IReadOnlyList<string> args)
        {
            invokedNetshCommands.Add(string.Join(" ", args));
            return (0, "Ok.");
        }

        var testNic = new NetworkInterfaceDiagnostic(
            Name: "Ethernet",
            Description: "Intel Ethernet Controller",
            InterfaceType: "Ethernet",
            OperationalStatus: "Up",
            SpeedBitsPerSecond: 1_000_000_000,
            IpAddresses: ["192.168.1.105"],
            GatewayAddresses: ["192.168.1.1"],
            DnsServers: ["192.168.1.1"],
            IsDhcpEnabled: true);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "dns_dhcp_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var trouble = new DiagnosticsAndTroubleshootingService(
            safeOperationEngine: safeEngine,
            customNetshRunner: NetshMock,
            customInterfaceInspector: () => [testNic]);

        // Propose switch to Cloudflare
        var proposal = trouble.ProposeSwitchDnsProvider("Cloudflare", "Ethernet");
        Assert.True(proposal.PrerequisitesMet);
        Assert.Equal(OperationReversibility.Reversible, proposal.Reversibility);

        // Execute Approved Proposal
        var exec = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);
        Assert.True(exec.CanRollback);

        // Assert netsh was called to set primary (1.1.1.1) and secondary (1.0.0.1)
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Ethernet source=static address=1.1.1.1"));
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Ethernet address=1.0.0.1 index=2"));

        // Rollback operation -> Must restore DHCP because PreviousWasDhcp was true!
        var rollback = await safeEngine.RollbackOperationAsync(exec.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.True(rollback.Verification.IsVerified);
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Ethernet source=dhcp"));
    }

    [Fact]
    public async Task DnsSwitching_SwitchFromStaticDns_RollbackRestoresStaticServers()
    {
        var invokedNetshCommands = new List<string>();
        (int ExitCode, string Output) NetshMock(IReadOnlyList<string> args)
        {
            invokedNetshCommands.Add(string.Join(" ", args));
            return (0, "Ok.");
        }

        var staticNic = new NetworkInterfaceDiagnostic(
            Name: "Wi-Fi",
            Description: "Wi-Fi 6 Adapter",
            InterfaceType: "Wireless80211",
            OperationalStatus: "Up",
            SpeedBitsPerSecond: 866_000_000,
            IpAddresses: ["10.0.0.50"],
            GatewayAddresses: ["10.0.0.1"],
            DnsServers: ["8.8.8.8", "8.8.4.4"],
            IsDhcpEnabled: false);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "dns_static_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var trouble = new DiagnosticsAndTroubleshootingService(
            safeOperationEngine: safeEngine,
            customNetshRunner: NetshMock,
            customInterfaceInspector: () => [staticNic]);

        var proposal = trouble.ProposeSwitchDnsProvider("Quad9", "Wi-Fi");
        Assert.True(proposal.PrerequisitesMet);

        var exec = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);

        // Netsh called for Quad9 (9.9.9.9 and 149.112.112.112)
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Wi-Fi source=static address=9.9.9.9"));

        // Rollback restores the original static 8.8.8.8 / 8.8.4.4
        var rollback = await safeEngine.RollbackOperationAsync(exec.ExecutionId);
        Assert.True(rollback.Succeeded);
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Wi-Fi source=static address=8.8.8.8"));
        Assert.Contains(invokedNetshCommands, c => c.Contains("name=Wi-Fi address=8.8.4.4 index=2"));
    }

    [Fact]
    public void DnsSwitching_InvalidProvider_FailsPrerequisiteCheckCleanly()
    {
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true));
        var trouble = new DiagnosticsAndTroubleshootingService(safeEngine);
        var proposal = trouble.ProposeSwitchDnsProvider("UnknownBogusDns");
        Assert.False(proposal.PrerequisitesMet);
        Assert.Contains("not a recognized DNS provider", proposal.PrerequisiteFailureReason);
        Assert.Empty(proposal.ConfirmationToken);
    }

    // =========================================================================
    // 3. CLEANUP ACCOUNTING & FAILURE HANDLING
    // =========================================================================

    [Fact]
    public void SafeCleanup_LockedFilesInUse_AreSkippedWithoutInflatingReclaimedBytes()
    {
        var testDir = Path.Combine(_tempRoot, "CleanupLockedDir");
        Directory.CreateDirectory(testDir);

        var file1 = Path.Combine(testDir, "file1.tmp");
        var file2 = Path.Combine(testDir, "locked.tmp");
        var file3 = Path.Combine(testDir, "file3.tmp");

        File.WriteAllBytes(file1, new byte[5000]);
        File.WriteAllBytes(file2, new byte[3000]);
        File.WriteAllBytes(file3, new byte[2000]);

        var cleanup = new SafeCleanupService();
        var proposal = cleanup.ProposeCleanup([file1, file2, file3], allowedRoots: [_tempRoot], mode: "permanent");

        // Hold a lock with FileShare.None on file2
        using (var lockStream = new FileStream(file2, FileMode.Open, FileAccess.ReadWrite, FileShare.None))
        {
            var report = cleanup.ExecuteCleanup(proposal.Token, allowedRoots: [_tempRoot]);

            Assert.Equal("partial", report.Status);
            Assert.Equal(2, report.RemovedCount);
            Assert.Equal(7000, report.BytesReclaimed); // 5000 + 2000 only; locked file NOT added!
            Assert.Single(report.FailedReasons);
            Assert.Contains("locked.tmp", report.FailedReasons[0]);

            Assert.False(File.Exists(file1));
            Assert.True(File.Exists(file2)); // Locked file must remain untouched
            Assert.False(File.Exists(file3));
        }
    }

    [Fact]
    public async Task SafeCleanup_HistoryPreservedAsIrreversible_RollbackAttemptIsCleanlyRejected()
    {
        var testTemp = Path.Combine(_tempRoot, "SafeTempStore");
        Directory.CreateDirectory(testTemp);
        var f1 = Path.Combine(testTemp, "scratch.tmp");
        File.WriteAllBytes(f1, new byte[4096]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "cleanup_safety_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var trouble = new DiagnosticsAndTroubleshootingService(
            safeOperationEngine: safeEngine,
            customTempDir: testTemp);

        var proposal = trouble.ProposeSafeTempAndCacheCleanup(includeClosedBrowserCaches: false);
        Assert.True(proposal.PrerequisitesMet);
        Assert.Equal(OperationReversibility.Irreversible, proposal.Reversibility);

        var record = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(record.Succeeded);
        Assert.False(record.CanRollback);
        Assert.Equal(OperationReversibility.Irreversible, record.Reversibility);
        Assert.Equal("Permanent (Audit Only)", record.LedgerClassificationBadge);

        // Attempting to rollback an irreversible operation must return a clean structured failure
        var rollback = await safeEngine.RollbackOperationAsync(record.ExecutionId);
        Assert.False(rollback.Succeeded);
        Assert.Contains("cannot be automatically rolled back", rollback.StatusMessage);
    }

    // =========================================================================
    // 4. PRIVACY REDACTION
    // =========================================================================

    [Fact]
    public async Task PrivacyRedaction_HardwareReportMasksSerials_AndDpapiProtectsKeys()
    {
        var hwService = new HardwareSpecsEngineService();
        var maskedReport = await hwService.GetHardwareReportAsync(maskSensitiveData: true);

        Assert.NotNull(maskedReport);

        // Serial numbers must not leak plaintext hardware identifiers
        if (!string.IsNullOrWhiteSpace(maskedReport.Motherboard.SerialNumber))
        {
            Assert.Contains("*", maskedReport.Motherboard.SerialNumber);
        }
        foreach (var disk in maskedReport.Disks)
        {
            if (!string.IsNullOrWhiteSpace(disk.SerialNumber) && disk.SerialNumber.Length > 4)
            {
                Assert.Contains("*", disk.SerialNumber);
            }
        }

        // DPAPI Protection verification
        const string rawSecret = "sk-live-groundwork-api-secret-key-12345";
        var encrypted = DpapiSecretProtector.Protect(rawSecret);
        Assert.NotEqual(rawSecret, encrypted);
        Assert.DoesNotContain("groundwork", encrypted);

        var decrypted = DpapiSecretProtector.Unprotect(encrypted);
        Assert.Equal(rawSecret, decrypted);

        // Legacy plaintext is preserved safely
        Assert.Equal("legacy-plain-key", DpapiSecretProtector.Unprotect("legacy-plain-key"));
    }

    // =========================================================================
    // 5. OPERATION-HISTORY INTEGRITY
    // =========================================================================

    [Fact]
    public void OperationHistoryService_BoundsRecordsAtLimit_AndMaintainsChronologicalOrder()
    {
        var historyFile = Path.Combine(_tempRoot, "bounded_history.json");
        var history = new OperationHistoryService(historyFile);

        for (int i = 0; i < 220; i++)
        {
            history.RecordExecution(new OperationExecutionRecord(
                ExecutionId: $"op-{i:D4}",
                ProposalId: $"prop-{i:D4}",
                OperationTypeId: "test.op",
                DisplayName: $"Operation {i}",
                Category: "Test",
                TargetDescription: $"Target {i}",
                Succeeded: true,
                StatusMessage: "Success",
                PreChangeStateJson: "{}",
                PostChangeStateSummary: "Done",
                Reversibility: OperationReversibility.Reversible,
                RiskLevel: OperationRiskLevel.Low,
                Verification: new OperationVerificationResult(true, "OK", "OK", DateTimeOffset.UtcNow),
                CanRollback: true,
                IsRolledBack: false,
                RollbackStatusMessage: string.Empty,
                RolledBackAtUtc: null,
                ExecutedAtUtc: DateTimeOffset.UtcNow.AddMinutes(i)));
        }

        var loaded = history.LoadRecords();
        Assert.Equal(200, loaded.Count); // Bounded strictly at 200
        Assert.Equal("op-0219", loaded[0].ExecutionId); // Most recent record first
    }

    [Fact]
    public void OperationHistoryService_CorruptedJsonFile_RecoversGracefullyWithoutCrashing()
    {
        var historyFile = Path.Combine(_tempRoot, "corrupted_history.json");
        File.WriteAllText(historyFile, "{ corrupted invalid json content [[[ [[[");

        var history = new OperationHistoryService(historyFile);
        var records = history.LoadRecords();
        Assert.NotNull(records);
        Assert.Empty(records); // Clean fallback rather than unhandled JSON crash
    }

    // =========================================================================
    // 6. AGENT TOOL SELECTION & IRRELEVANT-TOOL AVOIDANCE
    // =========================================================================

    [Fact]
    public async Task AgentToolSelection_SwitchDnsRequest_OnlyExecutesNetworkHealth_StrictlyAvoidsWindowsServices()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "agent_dns_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var troubleService = new DiagnosticsAndTroubleshootingService(safeEngine);
        var registry = new ToolRegistryService(troubleshootingService: troubleService);
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);

        var result = await planner.PlanAndInvestigateUserRequestAsync("Switch my DNS to Cloudflare");

        Assert.Equal(InvestigationType.Network, result.SelectedInvestigationType);

        // MUST execute inspect_network_health
        Assert.Contains("inspect_network_health", result.InvestigationReport.ExecutedTools);

        // MUST STRICTLY AVOID executing irrelevant tools for a DNS switch
        Assert.DoesNotContain("inspect_windows_services", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_storage_volumes", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_power_plans", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_cleanup_candidates", result.InvestigationReport.ExecutedTools);

        // Prepared proposal must be Switch DNS
        Assert.Contains(result.PendingApprovalProposals, p => p.OperationTypeId == DiagnosticsAndTroubleshootingService.SwitchDnsOperationId);
    }

    [Fact]
    public async Task AgentToolSelection_StorageFullRequest_OnlyExecutesStorageTools_StrictlyAvoidsUnrelatedTools()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "agent_storage_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var registry = new ToolRegistryService(
            troubleshootingService: new DiagnosticsAndTroubleshootingService(safeEngine),
            cleanupService: new SafeCleanupService());
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);

        var result = await planner.PlanAndInvestigateUserRequestAsync("Why is my C drive almost full?");

        Assert.Equal(InvestigationType.Storage, result.SelectedInvestigationType);

        // MUST execute storage tools
        Assert.Contains("inspect_storage_volumes", result.InvestigationReport.ExecutedTools);
        Assert.Contains("inspect_cleanup_candidates", result.InvestigationReport.ExecutedTools);

        // MUST STRICTLY AVOID irrelevant tools
        Assert.DoesNotContain("inspect_network_health", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_windows_services", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_power_plans", result.InvestigationReport.ExecutedTools);
    }

    [Fact]
    public async Task AgentToolSelection_StartupRequest_OnlyExecutesStartupTools()
    {
        var history = new OperationHistoryService(Path.Combine(_tempRoot, "agent_startup_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => true), history);
        var registry = new ToolRegistryService(optimizationService: new WindowsOptimizationService(safeEngine));
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);

        var result = await planner.PlanAndInvestigateUserRequestAsync("Which apps start automatically when I sign in?");

        Assert.Equal(InvestigationType.Startup, result.SelectedInvestigationType);

        // MUST execute startup inspection
        Assert.Contains("inspect_startup_items", result.InvestigationReport.ExecutedTools);

        // MUST STRICTLY AVOID irrelevant tools
        Assert.DoesNotContain("inspect_network_health", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_windows_services", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_storage_volumes", result.InvestigationReport.ExecutedTools);
    }

    [Fact]
    public async Task AgentToolSelection_HardwareSpecsRequest_OnlyExecutesHardwareTools()
    {
        var registry = new ToolRegistryService();
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry);

        var result = await planner.PlanAndInvestigateUserRequestAsync("Check my motherboard and GPU specs");

        Assert.Equal(InvestigationType.Hardware, result.SelectedInvestigationType);

        // MUST execute hardware inspection
        Assert.Contains("inspect_hardware_and_os", result.InvestigationReport.ExecutedTools);

        // MUST STRICTLY AVOID irrelevant tools
        Assert.DoesNotContain("inspect_cleanup_candidates", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_network_health", result.InvestigationReport.ExecutedTools);
        Assert.DoesNotContain("inspect_windows_services", result.InvestigationReport.ExecutedTools);
    }
}
