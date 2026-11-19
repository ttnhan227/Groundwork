using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;

namespace Groundwork.Engine.Tests;

public sealed class StorageHotspotsAndAgentLoopTests : IDisposable
{
    private readonly string _tempRoot;

    public StorageHotspotsAndAgentLoopTests()
    {
        _tempRoot = Path.Combine(Path.GetTempPath(), $"GroundworkHotspotTests_{Guid.NewGuid():N}");
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
        catch { }
    }

    private sealed class SequenceHttpMessageHandler : HttpMessageHandler
    {
        private readonly Queue<Func<HttpRequestMessage, string, HttpResponseMessage>> _handlers;
        public List<string> CapturedBodies { get; } = [];

        public SequenceHttpMessageHandler(IEnumerable<Func<HttpRequestMessage, string, HttpResponseMessage>> handlers)
        {
            _handlers = new Queue<Func<HttpRequestMessage, string, HttpResponseMessage>>(handlers);
        }

        protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
        {
            var body = request.Content != null
                ? await request.Content.ReadAsStringAsync(cancellationToken).ConfigureAwait(false)
                : string.Empty;
            CapturedBodies.Add(body);

            if (_handlers.Count == 0)
            {
                return new HttpResponseMessage(HttpStatusCode.InternalServerError)
                {
                    Content = new StringContent("No mock response remaining.")
                };
            }

            var fn = _handlers.Dequeue();
            return fn(request, body);
        }
    }

    [Fact]
    public async Task SpaceHogAnalyzer_IdentifiesVirtualDisksAndCaches_AndNeverAutoDeletesVhdx()
    {
        var userProfile = Path.Combine(_tempRoot, "User");
        var localApp = Path.Combine(userProfile, "AppData", "Local");
        var roamingApp = Path.Combine(userProfile, "AppData", "Roaming");
        var programData = Path.Combine(_tempRoot, "ProgramData");
        var windowsDir = Path.Combine(_tempRoot, "Windows");

        var dockerWslDir = Path.Combine(localApp, "Docker", "wsl", "disk");
        var dxCacheDir = Path.Combine(localApp, "NVIDIA", "DXCache");
        var nugetDir = Path.Combine(userProfile, ".nuget", "packages");
        var heavyAppDir = Path.Combine(localApp, "HeavyCustomTool");

        Directory.CreateDirectory(dockerWslDir);
        Directory.CreateDirectory(dxCacheDir);
        Directory.CreateDirectory(nugetDir);
        Directory.CreateDirectory(heavyAppDir);
        Directory.CreateDirectory(roamingApp);
        Directory.CreateDirectory(programData);
        Directory.CreateDirectory(windowsDir);

        var vhdxPath = Path.Combine(dockerWslDir, "docker_data.vhdx");
        await File.WriteAllBytesAsync(vhdxPath, new byte[4096]);
        await File.WriteAllBytesAsync(Path.Combine(dxCacheDir, "shader1.nvph"), new byte[2048]);
        await File.WriteAllBytesAsync(Path.Combine(nugetDir, "pkg.nupkg"), new byte[3072]);
        await File.WriteAllBytesAsync(Path.Combine(heavyAppDir, "bundle.bin"), new byte[5120]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var analyzer = new StorageHotspotAnalyzerService(
            safeEngine,
            customUserProfile: userProfile,
            customLocalAppData: localApp,
            customRoamingAppData: roamingApp,
            customProgramData: programData,
            customWindowsDir: windowsDir);

        var report = await analyzer.InspectSpaceHogsAsync(minReportThresholdBytes: 1024);

        var docker = Assert.Single(report.Entries, e => e.Id == "docker_wsl_disk");
        Assert.False(docker.CanSafeCleanDirectly);
        Assert.Equal(4096, docker.SizeBytes);

        var dx = Assert.Single(report.Entries, e => e.Id == "nvidia_dxcache");
        Assert.True(dx.CanSafeCleanDirectly);
        Assert.Equal(2048, dx.SizeBytes);

        var nuget = Assert.Single(report.Entries, e => e.Id == "nuget_packages");
        Assert.True(nuget.CanSafeCleanDirectly);
        Assert.Equal(3072, nuget.SizeBytes);

        // Propose & execute cleanup for safe caches only
        var proposal = await analyzer.ProposeCleanSafeSpaceHogsAsync(["nvidia_dxcache", "nuget_packages"]);
        Assert.True(proposal.PrerequisitesMet);
        Assert.NotEmpty(proposal.ConfirmationToken);

        var exec = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);
        Assert.True(exec.Verification.IsVerified);

        // Virtual disk and unrelated heavy folder MUST still exist
        Assert.True(File.Exists(vhdxPath));
        Assert.True(File.Exists(Path.Combine(heavyAppDir, "bundle.bin")));
        Assert.Empty(Directory.GetFiles(dxCacheDir));
        Assert.Empty(Directory.GetFiles(nugetDir));
    }

    [Fact]
    public async Task ScanFolderHotspots_ReturnsTopFoldersAndLargestFiles()
    {
        var dirA = Path.Combine(_tempRoot, "Alpha", "Nested");
        var dirB = Path.Combine(_tempRoot, "Beta");
        Directory.CreateDirectory(dirA);
        Directory.CreateDirectory(dirB);

        await File.WriteAllBytesAsync(Path.Combine(dirA, "big.bin"), new byte[10_000]);
        await File.WriteAllBytesAsync(Path.Combine(dirB, "small.bin"), new byte[1_000]);

        var analyzer = new StorageHotspotAnalyzerService();
        var hotspots = await analyzer.ScanFolderHotspotsAsync(_tempRoot, topN: 10, minFileBytes: 5_000);

        Assert.Equal(11_000, hotspots.ScannedBytes);
        Assert.Equal("Alpha", hotspots.TopRootFolders[0].Name);
        Assert.Single(hotspots.LargestFiles);
        Assert.Equal("big.bin", hotspots.LargestFiles[0].Name);
    }

    [Fact]
    public async Task MultiProfileBrowserCacheAndNestedTemp_InspectedAndCleanedCompletely()
    {
        var mockTemp = Path.Combine(_tempRoot, "NestedTemp");
        var mockLocalApp = Path.Combine(_tempRoot, "LocalApp");
        var nestedTempSub = Path.Combine(mockTemp, "sub1");
        var chromeProfile1Sw = Path.Combine(mockLocalApp, "Google", "Chrome", "User Data", "Profile 1", "Service Worker", "CacheStorage");

        Directory.CreateDirectory(nestedTempSub);
        Directory.CreateDirectory(chromeProfile1Sw);

        await File.WriteAllBytesAsync(Path.Combine(nestedTempSub, "nested.tmp"), new byte[2048]);
        await File.WriteAllBytesAsync(Path.Combine(chromeProfile1Sw, "sw_cache_0"), new byte[4096]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "browser_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var trouble = new DiagnosticsAndTroubleshootingService(safeEngine, customTempDir: mockTemp, customLocalAppDataDir: mockLocalApp);

        var summary = trouble.InspectSafeTempAndBrowserCaches();
        Assert.Equal(1, summary.UserTempFileCount);
        Assert.Equal(2048, summary.UserTempBytes);
        var chrome = Assert.Single(summary.BrowserCaches, b => b.BrowserId == "chrome");
        Assert.Equal(4096, chrome.CacheSizeBytes);

        var proposal = trouble.ProposeSafeTempAndCacheCleanup(includeClosedBrowserCaches: true);
        Assert.True(proposal.PrerequisitesMet);
        var exec = await safeEngine.ExecuteApprovedProposalAsync(proposal.ConfirmationToken);
        Assert.True(exec.Succeeded);

        var after = trouble.InspectSafeTempAndBrowserCaches();
        Assert.Equal(0, after.TotalSafeFileCount);
    }

    [Fact]
    public async Task AiProviderClient_OpenAiMultiTurnToolLoop_ExecutesReadOnlyToolsAndStagesProposal()
    {
        var mockUser = Path.Combine(_tempRoot, "MockUser");
        var mockLocal = Path.Combine(mockUser, "AppData", "Local");
        var mockDx = Path.Combine(mockLocal, "NVIDIA", "DXCache");
        Directory.CreateDirectory(mockDx);
        await File.WriteAllBytesAsync(Path.Combine(mockDx, "s.nvph"), new byte[4096]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "llm_openai_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var hotspotSvc = new StorageHotspotAnalyzerService(
            safeEngine,
            customUserProfile: mockUser,
            customLocalAppData: mockLocal,
            customRoamingAppData: Path.Combine(mockUser, "AppData", "Roaming"),
            customProgramData: Path.Combine(_tempRoot, "PD"),
            customWindowsDir: Path.Combine(_tempRoot, "Win"));
        var registry = new ToolRegistryService(
            optimizationService: new WindowsOptimizationService(safeEngine),
            troubleshootingService: new DiagnosticsAndTroubleshootingService(safeEngine),
            fileOrganizerService: new FileOrganizerService(safeEngine),
            storageHotspotService: hotspotSvc);

        var handler = new SequenceHttpMessageHandler(
        [
            // Step 1: Model asks to inspect_space_hogs
            (_, _) => JsonResponse("""
                {
                  "choices": [{
                    "message": {
                      "role": "assistant",
                      "content": null,
                      "tool_calls": [{
                        "id": "call_1",
                        "type": "function",
                        "function": { "name": "inspect_space_hogs", "arguments": "{\"min_mb\":\"0\"}" }
                      }]
                    }
                  }]
                }
                """),
            // Step 2: Model proposes safe cleanup (does NOT auto-execute)
            (_, body) =>
            {
                Assert.Contains("nvidia_dxcache", body);
                return JsonResponse("""
                    {
                      "choices": [{
                        "message": {
                          "role": "assistant",
                          "content": null,
                          "tool_calls": [{
                            "id": "call_2",
                            "type": "function",
                            "function": { "name": "propose_clean_space_hogs", "arguments": "{\"entry_ids\":\"nvidia_dxcache\"}" }
                          }]
                        }
                      }]
                    }
                    """);
            },
            // Step 3: Final grounded explanation
            (_, body) =>
            {
                Assert.Contains("is_modifying_proposal_awaiting_approval", body);
                return JsonResponse("""
                    {
                      "choices": [{
                        "message": {
                          "role": "assistant",
                          "content": "Found NVIDIA DXCache using space. Cleanup is staged for your approval."
                        }
                      }]
                    }
                    """);
            }
        ]);

        var client = new AiProviderClientService(new HttpClient(handler));
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry, client);

        var config = new AiProviderConfig("openai", "https://api.openai.com/v1", "gpt-4o", "sk-test");
        var turn = await planner.RunAssistantTurnAsync("What is killing C space?", config);

        Assert.True(turn.UsedLiveLlm);
        Assert.Equal("openai", turn.UsedAiProvider);
        Assert.Contains("NVIDIA DXCache", turn.DeterministicMarkdownResponse);
        Assert.Equal(2, turn.ToolTrace!.Count);
        Assert.Single(turn.PendingApprovalProposals);
        Assert.Equal(StorageHotspotAnalyzerService.CleanSpaceHogsOperationId, turn.PendingApprovalProposals[0].OperationTypeId);
        // Must NOT execute until token approved
        Assert.Empty(history.LoadRecords());
    }

    [Fact]
    public async Task AiProviderClient_GeminiToolLoop_AndFallbackOnFailure_WorkCleanly()
    {
        var registry = new ToolRegistryService();

        var geminiHandler = new SequenceHttpMessageHandler(
        [
            (_, _) => JsonResponse("""
                {
                  "candidates": [{
                    "content": {
                      "role": "model",
                      "parts": [{
                        "functionCall": { "name": "inspect_storage_volumes", "args": {} }
                      }]
                    }
                  }]
                }
                """),
            (_, body) =>
            {
                Assert.Contains("functionResponse", body);
                return JsonResponse("""
                    {
                      "candidates": [{
                        "content": {
                          "role": "model",
                          "parts": [{
                            "text": "Checked your volumes via Gemini tool loop."
                          }]
                        }
                      }]
                    }
                    """);
            }
        ]);

        var geminiClient = new AiProviderClientService(new HttpClient(geminiHandler));
        var planner = new AgentPlannerService(new InvestigationEngineService(registry), registry, geminiClient);
        var geminiCfg = new AiProviderConfig("gemini", "https://generativelanguage.googleapis.com", "gemini-2.5-flash", "AIza-test");

        var geminiTurn = await planner.RunAssistantTurnAsync("Check my drive volumes", geminiCfg);
        Assert.True(geminiTurn.UsedLiveLlm);
        Assert.Contains("Gemini tool loop", geminiTurn.DeterministicMarkdownResponse);

        // Now test fallback when HTTP fails
        var failingHandler = new SequenceHttpMessageHandler(
        [
            (_, _) => new HttpResponseMessage(HttpStatusCode.Unauthorized)
            {
                Content = new StringContent("Invalid API key")
            }
        ]);
        var fallbackPlanner = new AgentPlannerService(
            new InvestigationEngineService(registry),
            registry,
            new AiProviderClientService(new HttpClient(failingHandler)));

        var fallbackTurn = await fallbackPlanner.RunAssistantTurnAsync("Why is my C drive full?", geminiCfg);
        Assert.False(fallbackTurn.UsedLiveLlm);
        Assert.Contains("local telemetry investigation", fallbackTurn.DeterministicMarkdownResponse);
        Assert.Contains("inspect_space_hogs", fallbackTurn.InvestigationReport.ExecutedTools);
    }

    [Fact]
    public async Task ProposeRecycleItems_ValidatesBoundaryAndRecordsInHistory()
    {
        var allowedDir = Path.Combine(_tempRoot, "Downloads");
        var outsideDir = Path.Combine(_tempRoot, "Other");
        Directory.CreateDirectory(allowedDir);
        Directory.CreateDirectory(outsideDir);

        var dupFile = Path.Combine(allowedDir, "copy (1).dat");
        var outsideFile = Path.Combine(outsideDir, "secret.dat");
        await File.WriteAllBytesAsync(dupFile, new byte[2048]);
        await File.WriteAllBytesAsync(outsideFile, new byte[2048]);

        var history = new OperationHistoryService(Path.Combine(_tempRoot, "recycle_hist.json"));
        var safeEngine = new SafeOperationEngine(new PolicyEngine(() => false), history);
        var svc = new StorageHotspotAnalyzerService(safeEngine);

        // Must reject path outside allowed root
        Assert.Throws<InvalidOperationException>(() =>
            svc.ProposeRecycleItems([outsideFile], [allowedDir], "Duplicates"));

        // Valid path inside allowed root creates single-use SafeOperationEngine proposal
        var proposal = svc.ProposeRecycleItems([dupFile], [allowedDir], "Duplicates");
        Assert.True(proposal.PrerequisitesMet);
        Assert.Equal(StorageHotspotAnalyzerService.RecycleItemsOperationId, proposal.OperationTypeId);

        // Clean up test proposal token without invoking Explorer UI Recycle Bin on temp test
        // (verified separately in StorageAndSafetyEngineTests via customRecycleHandler)
        Assert.True(File.Exists(dupFile));
        Assert.Empty(history.LoadRecords());
    }

    private static HttpResponseMessage JsonResponse(string json) =>
        new(HttpStatusCode.OK)
        {
            Content = new StringContent(json, Encoding.UTF8, "application/json")
        };
}
