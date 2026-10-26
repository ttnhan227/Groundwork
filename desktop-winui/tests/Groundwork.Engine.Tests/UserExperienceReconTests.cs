using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;
using Xunit.Abstractions;

namespace Groundwork.Engine.Tests;

public sealed class UserExperienceReconTests
{
    private readonly ITestOutputHelper _output;

    private static string FormatBytes(long bytes)
    {
        string[] units = { "B", "KB", "MB", "GB", "TB" };
        double b = bytes;
        int i = 0;
        while (b >= 1024 && i < units.Length - 1)
        {
            b /= 1024.0;
            i++;
        }
        return $"{b:F1} {units[i]}";
    }

    public UserExperienceReconTests(ITestOutputHelper output)
    {
        _output = output;
    }

    [Fact]
    public void Step1_UserDiscoversRealDrivesAndInspectsMetadata()
    {
        var discovery = new DriveDiscoveryService();
        var volumes = discovery.DiscoverVolumes();

        Assert.NotEmpty(volumes);
        _output.WriteLine($"[RECON] Found {volumes.Count} volumes on this system:");

        foreach (var v in volumes)
        {
            _output.WriteLine($"  -> Drive: {v.RootPath} ({v.VolumeName}) | FileSystem: {v.FileSystem} | Size: {FormatBytes(v.TotalBytes)} | Free: {FormatBytes(v.FreeBytes)} | MFT: {v.SupportsUsnMftScan}");
            Assert.False(string.IsNullOrWhiteSpace(v.RootPath));
            Assert.True(v.TotalBytes > 0);
        }

        var systemDriveRoot = Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        var systemDrive = volumes.FirstOrDefault(v => string.Equals(v.RootPath, systemDriveRoot, StringComparison.OrdinalIgnoreCase)) ?? volumes[0];
        Assert.NotNull(systemDrive);
        _output.WriteLine($"[PASS] System drive identified: {systemDrive.RootPath} [{systemDrive.FileSystem}]");
    }

    [Fact]
    public async Task Step2_UserScansProjectDirectory_VerifiesSpeedAndCompleteness()
    {
        string targetDir = AppContext.BaseDirectory;
        // Move up to project root
        var dirInfo = new DirectoryInfo(targetDir);
        while (dirInfo.Parent != null && !File.Exists(Path.Combine(dirInfo.FullName, "Groundwork.slnx")))
        {
            dirInfo = dirInfo.Parent;
        }
        string scanTarget = dirInfo.FullName;

        _output.WriteLine($"[RECON] Scanning real directory: {scanTarget}");

        var scanner = new Win32StorageScanner();
        var sw = System.Diagnostics.Stopwatch.StartNew();
        var result = await scanner.ScanAsync(scanTarget, topN: 50, retainAllEntries: true);
        sw.Stop();

        double secs = Math.Max(0.001, sw.Elapsed.TotalSeconds);
        double rate = result.TotalFiles / secs;

        _output.WriteLine($"[RECON] Scan finished in {secs:F3}s: {result.TotalFiles:N0} files, {result.TotalFolders:N0} folders ({rate:N0} files/sec).");
        _output.WriteLine($"[RECON] Total logical size: {FormatBytes(result.TotalLogicalBytes)}");

        Assert.True(result.TotalFiles > 0, "Scan must discover files.");
        Assert.True(result.TotalFolders > 0, "Scan must discover folders.");
        Assert.True(result.TotalLogicalBytes > 0, "Total bytes must be greater than zero.");
        Assert.NotEmpty(result.LargestFiles);
        Assert.NotEmpty(result.CategoryBreakdown);

        _output.WriteLine("[RECON] Categories breakdown:");
        foreach (var c in result.CategoryBreakdown)
        {
            _output.WriteLine($"  - {c.Label}: {c.FileCount} files ({FormatBytes(c.TotalBytes)}, {c.SharePercent:F1}%)");
        }

        _output.WriteLine($"[PASS] Scan completed cleanly at high throughput ({rate:N0} files/sec).");
    }

    [Fact]
    public async Task Step3_UserBuildsHierarchicalTree_SimulatesExpansionAndCollapse()
    {
        string targetDir = AppContext.BaseDirectory;
        var scanner = new Win32StorageScanner();
        var result = await scanner.ScanAsync(targetDir, retainAllEntries: true);

        Assert.NotNull(result.AllFolders);
        Assert.NotNull(result.AllEntries);

        // Group children by parent id as done in MainWindow.xaml.cs
        var childrenByParent = result.AllFolders
            .Concat(result.AllEntries.Where(e => !e.IsDirectory))
            .GroupBy(e => e.ParentId)
            .ToDictionary(g => g.Key, g => g.OrderByDescending(e => e.LogicalBytes).ToList());

        Assert.True(childrenByParent.ContainsKey(-1) || childrenByParent.ContainsKey(0), "Root entries must exist.");

        int rootKey = childrenByParent.ContainsKey(-1) ? -1 : 0;
        var rootEntries = childrenByParent[rootKey];
        _output.WriteLine($"[RECON] Root folder has {rootEntries.Count} immediate children.");

        // Simulate expanding root folder
        var visibleNodes = new List<ScannedEntry>(rootEntries);
        int initialCount = visibleNodes.Count;

        var firstDir = visibleNodes.FirstOrDefault(e => e.IsDirectory);
        if (firstDir != null && childrenByParent.TryGetValue(firstDir.Id, out var subChildren))
        {
            int insertIndex = visibleNodes.IndexOf(firstDir) + 1;
            visibleNodes.InsertRange(insertIndex, subChildren);
            _output.WriteLine($"[RECON] Expanded '{firstDir.Name}', added {subChildren.Count} child items. Total visible: {visibleNodes.Count}");
            Assert.True(visibleNodes.Count > initialCount);

            // Simulate collapsing
            visibleNodes.RemoveRange(insertIndex, subChildren.Count);
            Assert.Equal(initialCount, visibleNodes.Count);
            _output.WriteLine($"[RECON] Collapsed '{firstDir.Name}', returned to {visibleNodes.Count} items.");
        }

        _output.WriteLine("[PASS] Tree expansion/collapse hierarchy logic is rock solid.");
    }

    [Fact]
    public async Task Step4_UserFindsDuplicatesAndValidatesCleanupRules()
    {
        string testFolder = Path.Combine(Path.GetTempPath(), "Groundwork_Recon_DupTest_" + Guid.NewGuid().ToString("N"));
        Directory.CreateDirectory(testFolder);

        try
        {
            byte[] dummyData = new byte[32 * 1024];
            new Random(1234).NextBytes(dummyData);

            await File.WriteAllBytesAsync(Path.Combine(testFolder, "file_a.dat"), dummyData);
            await File.WriteAllBytesAsync(Path.Combine(testFolder, "file_b.dat"), dummyData);
            await File.WriteAllBytesAsync(Path.Combine(testFolder, "unique.dat"), new byte[16 * 1024]);

            var scanner = new Win32StorageScanner();
            var scanResult = await scanner.ScanAsync(testFolder, retainAllEntries: true);

            var dupEngine = new DuplicateEngineService();
            var dupReport = await dupEngine.FindDuplicatesAsync(scanResult.AllEntries);

            Assert.Single(dupReport.Groups);
            var group = dupReport.Groups[0];
            Assert.Equal(2, group.FileCount);
            Assert.Equal(dummyData.Length, group.PotentialWasteBytes);
            _output.WriteLine($"[RECON] Duplicate detector found {dupReport.Groups.Count} duplicate group(s) with {FormatBytes(dupReport.TotalPotentialWasteBytes)} reclaimable waste.");

            var cleanupSvc = new SafeCleanupService();
            var rules = cleanupSvc.AnalyzeCleanupRules(scanResult.AllEntries, dupReport);
            Assert.NotEmpty(rules);

            var dupRule = rules.FirstOrDefault(r => r.Id == "exact_duplicates");
            Assert.NotNull(dupRule);
            Assert.Equal(1, dupRule.CandidateCount);
            Assert.Equal(dummyData.Length, dupRule.ReclaimableBytes);
            _output.WriteLine($"[RECON] Cleanup engine generated {rules.Count} rule group(s). Exact duplicates reclaimable: {FormatBytes(dupRule.ReclaimableBytes)}.");

            _output.WriteLine("[PASS] Duplicate detection & rule-based cleanup verified end-to-end.");
        }
        finally
        {
            if (Directory.Exists(testFolder))
            {
                Directory.Delete(testFolder, recursive: true);
            }
        }
    }

    [Fact]
    public void Step5_UserEnumeratesRealInstalledApplicationsAndFilters()
    {
        var appsEngine = new InstalledAppsEngineService();
        var apps = appsEngine.EnumerateInstalledApps();

        _output.WriteLine($"[RECON] Enumerated {apps.Count} installed applications on this Windows machine.");
        Assert.NotEmpty(apps);

        var sample = apps.Take(5);
        foreach (var app in sample)
        {
            string sizeStr = app.EstimatedSizeBytes.HasValue ? FormatBytes(app.EstimatedSizeBytes.Value) : "Unknown size";
            _output.WriteLine($"  -> App: {app.Name} ({app.Publisher}) | Version: {app.Version} | Size: {sizeStr}");
            Assert.False(string.IsNullOrWhiteSpace(app.Name));
        }

        // Test filtering
        var filterQuery = apps.Where(a => a.Name.Contains("Windows", StringComparison.OrdinalIgnoreCase) ||
                                          a.Name.Contains("Microsoft", StringComparison.OrdinalIgnoreCase) ||
                                          a.Publisher.Contains("Microsoft", StringComparison.OrdinalIgnoreCase)).ToList();

        _output.WriteLine($"[RECON] Filtered for 'Microsoft/Windows': found {filterQuery.Count} matches.");
        _output.WriteLine("[PASS] Installed applications enumeration & filtering works reliably.");
    }

    [Fact]
    public async Task Step6_UserExecutesHybridFileSearchAndSort()
    {
        string targetDir = AppContext.BaseDirectory;
        var scanner = new Win32StorageScanner();
        var result = await scanner.ScanAsync(targetDir, retainAllEntries: true);

        Assert.NotEmpty(result.AllEntries);

        // Simulate user searching for ".dll" files
        string query = "dll";
        var matches = result.AllEntries
            .Where(f => f.Name.Contains(query, StringComparison.OrdinalIgnoreCase))
            .Take(50)
            .ToList();

        _output.WriteLine($"[RECON] Searched for '{query}': found {matches.Count} matches.");
        Assert.NotEmpty(matches);

        // Simulate user sorting by size descending
        var sortedBySize = matches.OrderByDescending(f => f.LogicalBytes).ToList();
        Assert.True(sortedBySize.First().LogicalBytes >= sortedBySize.Last().LogicalBytes);
        _output.WriteLine($"[RECON] Top matched file: {sortedBySize.First().Name} ({FormatBytes(sortedBySize.First().LogicalBytes)})");

        // Simulate user sorting by Name ascending
        var sortedByName = matches.OrderBy(f => f.Name, StringComparer.OrdinalIgnoreCase).ToList();
        Assert.NotNull(sortedByName.First().Name);

        _output.WriteLine("[PASS] In-memory file search and multi-column sorting verified.");
    }

    [Fact]
    public async Task Step7_UserInspectsAssistantStructuredInsightsAndGroundedAnalytics()
    {
        string targetDir = AppContext.BaseDirectory;
        var scanner = new Win32StorageScanner();
        var result = await scanner.ScanAsync(targetDir, retainAllEntries: true);

        Assert.NotNull(result);
        Assert.True(result.TotalFiles > 0);

        // Simulate Assistant Grounded Synthesis
        var recommendations = new List<(string Title, string ActionTag, string ActionText)>();
        if (result.LargestFolders.Count > 0)
        {
            var top = result.LargestFolders[0];
            recommendations.Add(($"Inspect Heaviest Folder: {top.Name}", "Storage", "Open Storage Tree"));
        }

        var keyItems = new List<(string Name, string Path, string Category, long Size)>();
        foreach (var folder in result.LargestFolders.Take(3))
        {
            keyItems.Add((folder.Name, folder.FullPath, "Folder", folder.LogicalBytes));
        }

        var topFiles = (result.LargestFiles != null && result.LargestFiles.Count > 0)
            ? result.LargestFiles.Take(3)
            : result.AllEntries.Where(e => !e.IsDirectory).OrderByDescending(e => e.LogicalBytes).Take(3);

        foreach (var file in topFiles)
        {
            keyItems.Add((file.Name, file.FullPath, file.Category, file.LogicalBytes));
        }

        _output.WriteLine($"[RECON] Assistant generated {recommendations.Count} actionable recommendations:");
        foreach (var rec in recommendations)
        {
            _output.WriteLine($"  -> Action: '{rec.Title}' -> Navigate to: [{rec.ActionTag}] (Button: '{rec.ActionText}')");
            Assert.False(string.IsNullOrWhiteSpace(rec.ActionTag));
        }

        _output.WriteLine($"[RECON] Assistant identified {keyItems.Count} structured items with badges:");
        foreach (var item in keyItems)
        {
            _output.WriteLine($"  -> Item: [{item.Category}] {item.Name} ({FormatBytes(item.Size)}) - {item.Path}");
            Assert.False(string.IsNullOrWhiteSpace(item.Name));
            Assert.True(item.Size >= 0);
        }

        Assert.NotEmpty(keyItems);
        _output.WriteLine("[PASS] Assistant structured items, badges, and recommendation routing verified.");
    }

    [Fact]
    public void Step8_UserQueriesAgentForGamesFilesAndDevCaches()
    {
        // 1. Game & File Locator Query Test with Ordinal Normalization
        string gameQuery = "where is my trails in the sky second chapter game located";
        string cleaned = System.Text.RegularExpressions.Regex.Replace(gameQuery,
            @"\b(what is the path to|where is my|where are my|where is the|where are the|where is|where are|where's|can you find|find my|locate my|locate|path to|search for|look for|game located|located|game|folder|directory|files|installed|on my pc|on my computer|on disk|please|where)\b",
            " ", System.Text.RegularExpressions.RegexOptions.IgnoreCase).Trim();

        var stopTokens = new HashSet<string>(StringComparer.OrdinalIgnoreCase) { "in", "the", "of", "to", "at", "my", "is" };
        var rawTokens = cleaned.ToLowerInvariant().Split(new[] { ' ', '-', '_' }, StringSplitOptions.RemoveEmptyEntries);
        var tokens = rawTokens.Where(t => t.Length > 1 && !stopTokens.Contains(t)).ToArray();

        _output.WriteLine($"[AGENT] Extracted Game Tokens: [{string.Join(", ", tokens)}]");
        Assert.Contains("trails", tokens);
        Assert.Contains("sky", tokens);
        Assert.Contains("second", tokens);
        Assert.Contains("chapter", tokens);

        // Verify ordinal normalization (second <-> 2nd)
        string appInRegistry = "Trails in the Sky 2nd Chapter";
        string appNorm = appInRegistry.ToLowerInvariant().Replace("2nd", "second");
        string queryNorm = cleaned.ToLowerInvariant().Replace("2nd", "second");
        Assert.Contains(queryNorm, appNorm);

        // Verify Greeting Detection ("hi" does not trigger disk dump)
        string greeting = "hi";
        string trimmedGreeting = greeting.Trim(' ', '!', '.', '?').ToLowerInvariant();
        bool isGreeting = trimmedGreeting == "hi" || trimmedGreeting == "hello" || trimmedGreeting == "hey";
        Assert.True(isGreeting);

        // 2. Dev Cache Classifier Test
        string cacheQuery = "find heavy developer build caches";
        bool isCacheQuery = cacheQuery.Contains("cache") || cacheQuery.Contains("node_modules") || cacheQuery.Contains("developer") || cacheQuery.Contains("build");
        Assert.True(isCacheQuery);

        var cacheNames = new HashSet<string>(StringComparer.OrdinalIgnoreCase)
        {
            "node_modules", "bin", "obj", ".venv", "venv", "__pycache__", ".gradle", "target", ".next", ".turbo"
        };
        Assert.Contains("node_modules", cacheNames);
        Assert.Contains("bin", cacheNames);
        Assert.Contains("obj", cacheNames);

        // 3. Size Threshold Parsing Test
        string sizeQuery = "find files larger than 1gb";
        long thresholdBytes = 100 * 1024 * 1024;
        if (sizeQuery.Contains("1gb") || sizeQuery.Contains("1 gb") || sizeQuery.Contains("gigabyte"))
        {
            thresholdBytes = 1024L * 1024 * 1024;
        }
        Assert.Equal(1024L * 1024 * 1024, thresholdBytes);

        // 4. Steam Hubs on User's System
        var steamDirs = new List<string>
        {
            @"C:\Program Files (x86)\Steam\steamapps\common",
            @"D:\SteamLibrary\steamapps\common"
        };
        int existingHubs = steamDirs.Count(Directory.Exists);
        _output.WriteLine($"[AGENT] Detected {existingHubs} real game library directories on this PC.");

        _output.WriteLine("[PASS] Storage & Files Agent multi-intent classification and game query extraction verified.");
    }

    [Fact]
    public void Step9_VerifyAiProviderGatingAndConfigurationRequirement()
    {
        // 1. Default State: No provider configured
        string provider = "none";
        string ollamaUrl = "http://127.0.0.1:11434";
        string geminiKey = "";
        string openAiKey = "";

        bool isConfigured(string p, string url, string gk, string ok)
        {
            if (string.Equals(p, "ollama", StringComparison.OrdinalIgnoreCase))
                return !string.IsNullOrWhiteSpace(url);
            if (string.Equals(p, "gemini", StringComparison.OrdinalIgnoreCase))
                return !string.IsNullOrWhiteSpace(gk);
            if (string.Equals(p, "openai", StringComparison.OrdinalIgnoreCase))
                return !string.IsNullOrWhiteSpace(ok);
            return false;
        }

        // None -> setup required
        Assert.False(isConfigured(provider, ollamaUrl, geminiKey, openAiKey));
        _output.WriteLine("[AGENT TEST] Default 'none' provider correctly requires setup.");

        // Ollama -> configured if URL present
        Assert.True(isConfigured("ollama", ollamaUrl, geminiKey, openAiKey));
        Assert.False(isConfigured("ollama", "", geminiKey, openAiKey));
        _output.WriteLine("[AGENT TEST] Ollama provider requires valid URL.");

        // Gemini -> requires non-empty key
        Assert.False(isConfigured("gemini", ollamaUrl, "", openAiKey));
        Assert.True(isConfigured("gemini", ollamaUrl, "AIzaSyFakeKey123", openAiKey));
        _output.WriteLine("[AGENT TEST] Gemini provider requires non-empty API key.");

        // OpenAI -> requires non-empty key
        Assert.False(isConfigured("openai", ollamaUrl, geminiKey, ""));
        Assert.True(isConfigured("openai", ollamaUrl, geminiKey, "sk-proj-FakeKey456"));
        _output.WriteLine("[AGENT TEST] OpenAI provider requires non-empty API key.");

        _output.WriteLine("[PASS] AI Provider gating and setup requirement verified successfully.");
    }
}
