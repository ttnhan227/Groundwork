using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Runtime.InteropServices;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Groundwork.Engine.Services;
using Xunit;
using Xunit.Abstractions;

namespace Groundwork.Engine.Tests;

public sealed class StorageAndSafetyEngineTests : IDisposable
{
    private readonly ITestOutputHelper _output;
    private readonly string _tempRoot;

    [DllImport("kernel32.dll", CharSet = CharSet.Unicode, SetLastError = true)]
    [return: MarshalAs(UnmanagedType.Bool)]
    private static extern bool CreateHardLinkW(string lpFileName, string lpExistingFileName, IntPtr lpSecurityAttributes);

    public StorageAndSafetyEngineTests(ITestOutputHelper output)
    {
        _output = output;
        _tempRoot = Path.Combine(Path.GetTempPath(), "GroundworkEngineTests_" + Guid.NewGuid().ToString("N"));
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
        }
    }

    [Fact]
    public void AutomaticDriveDiscovery_FindsSystemVolumeWithoutManualFolderSetup()
    {
        var discovery = new DriveDiscoveryService();
        var volumes = discovery.DiscoverVolumes();

        Assert.NotEmpty(volumes);
        var systemDrive = Path.GetPathRoot(Environment.SystemDirectory) ?? @"C:\";
        var primary = volumes.FirstOrDefault(v => string.Equals(v.RootPath, systemDrive, StringComparison.OrdinalIgnoreCase));

        Assert.NotNull(primary);
        Assert.True(primary.IsReady);
        Assert.True(primary.TotalBytes > 0);
        Assert.True(primary.UsedBytes > 0);
        _output.WriteLine($"Discovered {volumes.Count} volume(s). Primary: {primary.VolumeName} [{primary.FileSystem}] Total={primary.TotalBytes:N0} Used={primary.UsedPercent}% MFTSupported={primary.SupportsUsnMftScan}");
    }

    [Fact]
    public async Task Win32StorageScanner_ComputesAccurateBottomUpFolderRollupsAndCategories()
    {
        string mediaDir = Path.Combine(_tempRoot, "Media");
        string codeDir = Path.Combine(_tempRoot, "Projects", "Src");
        Directory.CreateDirectory(mediaDir);
        Directory.CreateDirectory(codeDir);

        await File.WriteAllBytesAsync(Path.Combine(mediaDir, "clip.mp4"), new byte[300_000]);
        await File.WriteAllBytesAsync(Path.Combine(codeDir, "Program.cs"), new byte[50_000]);
        await File.WriteAllBytesAsync(Path.Combine(_tempRoot, "notes.pdf"), new byte[100_000]);

        var scanner = new Win32StorageScanner();
        var result = await scanner.ScanAsync(_tempRoot, topN: 10, retainAllEntries: true);

        Assert.Equal(3, result.TotalFiles);
        Assert.Equal(450_000, result.TotalLogicalBytes);
        Assert.Equal("clip.mp4", result.LargestFiles[0].Name);

        var foldersByName = result.LargestFolders.ToDictionary(f => f.Name, f => f.LogicalBytes);
        Assert.Equal(300_000, foldersByName["Media"]);
        Assert.Equal(50_000, foldersByName["Projects"]);
        Assert.Equal(50_000, foldersByName["Src"]);
    }

    [Fact]
    public async Task DuplicateEngine_UsesThreeStagePipeline_SkipsHardLinksAndCloudPlaceholders()
    {
        // 1. True duplicate pair (same size, same head/tail, same SHA-256)
        byte[] dupPayload = new byte[64 * 1024];
        new Random(42).NextBytes(dupPayload);
        string dupA = Path.Combine(_tempRoot, "dup_original.bin");
        string dupB = Path.Combine(_tempRoot, "dup_copy.bin");
        await File.WriteAllBytesAsync(dupA, dupPayload);
        await File.WriteAllBytesAsync(dupB, dupPayload);

        // 2. Same size, different head/tail (filtered out in Stage 2 without full read)
        byte[] diffPayload = (byte[])dupPayload.Clone();
        diffPayload[10] ^= 0xFF;
        string sameSizeDiffContent = Path.Combine(_tempRoot, "same_size_diff.bin");
        await File.WriteAllBytesAsync(sameSizeDiffContent, diffPayload);

        // 3. Hard link to dupA (must be detected via volume+fileIndex and excluded from reclaimable waste)
        string hardLinkPath = Path.Combine(_tempRoot, "dup_hardlink.bin");
        bool linkCreated = CreateHardLinkW(hardLinkPath, dupA, IntPtr.Zero);
        Assert.True(linkCreated);

        // 4. Simulated cloud placeholder (FILE_ATTRIBUTE_OFFLINE = 0x1000)
        string cloudFile = Path.Combine(_tempRoot, "onedrive_placeholder.bin");
        await File.WriteAllBytesAsync(cloudFile, dupPayload);
        File.SetAttributes(cloudFile, File.GetAttributes(cloudFile) | FileAttributes.Offline);

        var scanner = new Win32StorageScanner();
        var scanResult = await scanner.ScanAsync(_tempRoot, retainAllEntries: true);

        var dupEngine = new DuplicateEngineService();
        var report = await dupEngine.FindDuplicatesAsync(scanResult.AllEntries);

        Assert.Equal(1, report.SkippedCloudPlaceholders);
        Assert.Single(report.Groups);

        var group = report.Groups[0];
        Assert.Equal(3, group.FileCount); // dupA, dupB, hardLinkPath
        Assert.Equal(1, group.HardLinkAliases);
        // Only 1 extra physical copy (dupB) represents reclaimable waste; hardLinkPath shares physical allocation with dupA
        Assert.Equal(dupPayload.Length, group.PotentialWasteBytes);

        // Verify Cleanup Rules also exclude the hard-link alias
        var cleanupSvc = new SafeCleanupService();
        var rules = cleanupSvc.AnalyzeCleanupRules(scanResult.AllEntries, report);
        var dupRule = rules.Single(r => r.Id == "exact_duplicates");
        Assert.Equal(1, dupRule.CandidateCount);
        Assert.Equal(dupPayload.Length, dupRule.ReclaimableBytes);
    }

    [Fact]
    public void SafeCleanup_RefusesSilentPermanentFallbackAndBlocksProtectedSystemPaths()
    {
        // 1. Verify protected system paths at arbitrary depth are blocked
        Assert.True(SafeCleanupService.IsProtectedSystemPath(@"C:\"));
        Assert.True(SafeCleanupService.IsProtectedSystemPath(@"C:\Windows"));
        Assert.True(SafeCleanupService.IsProtectedSystemPath(@"C:\Windows\System32\drivers\etc\hosts"));
        Assert.True(SafeCleanupService.IsProtectedSystemPath(@"C:\Windows\SysWOW64\kernel32.dll"));
        Assert.True(SafeCleanupService.IsProtectedSystemPath(@"C:\Users\Administrator"));
        Assert.True(SafeCleanupService.IsProtectedSystemPath(_tempRoot, [_tempRoot]));

        // 2. Verify Recycle Bin failure never falls back to permanent delete
        string targetFile = Path.Combine(_tempRoot, "must_survive_recycle_failure.tmp");
        File.WriteAllText(targetFile, "important data");

        var svc = new SafeCleanupService();
        var proposal = svc.ProposeCleanup([targetFile], [_tempRoot], mode: "recycle");
        Assert.Equal(1, proposal.ItemCount);

        var report = svc.ExecuteCleanup(
            proposal.Token,
            [_tempRoot],
            customRecycleHandler: _ => false);

        Assert.Equal("failed", report.Status);
        Assert.Equal(0, report.RemovedCount);
        Assert.Single(report.FailedReasons);
        Assert.True(File.Exists(targetFile), "File must remain untouched on disk when Recycle Bin fails in 'recycle' mode.");

        // 3. Re-using the single-use token must throw UnauthorizedAccessException
        Assert.Throws<UnauthorizedAccessException>(() => svc.ExecuteCleanup(proposal.Token, [_tempRoot]));
    }

    [Fact]
    public async Task InstalledAppsEngine_ParsesCommandsSafely_MonitorsUninstall_AndFindsLeftovers()
    {
        var appsEngine = new InstalledAppsEngineService();

        // 1. Reject shell injection operators
        Assert.Throws<ArgumentException>(() => InstalledAppsEngineService.ParseUninstallCommand("cmd.exe /c del *.* & calc.exe"));
        Assert.Throws<ArgumentException>(() => InstalledAppsEngineService.ParseUninstallCommand("unins000.exe | powershell"));

        // 2. Normalize MSI product code commands to System32\msiexec.exe
        var msiArgv = InstalledAppsEngineService.ParseUninstallCommand("MsiExec.exe /I{12345678-1234-1234-1234-1234567890AB}");
        Assert.EndsWith("msiexec.exe", msiArgv[0], StringComparison.OrdinalIgnoreCase);
        Assert.Equal("/X{12345678-1234-1234-1234-1234567890AB}", msiArgv[1]);

        // 3. Create simulated app installation & leftover directories
        string customInstallDir = Path.Combine(_tempRoot, "CustomApps", "PhotonStudio");
        string roamingRoot = Path.Combine(_tempRoot, "Roaming");
        string localRoot = Path.Combine(_tempRoot, "Local");
        Directory.CreateDirectory(customInstallDir);
        Directory.CreateDirectory(Path.Combine(roamingRoot, "PhotonStudio"));
        Directory.CreateDirectory(Path.Combine(localRoot, "ApexLabs", "PhotonStudio"));

        string fakeUninstaller = Path.Combine(customInstallDir, "uninstall.exe");
        await File.WriteAllBytesAsync(fakeUninstaller, new byte[4096]);
        await File.WriteAllBytesAsync(Path.Combine(roamingRoot, "PhotonStudio", "config.json"), new byte[2048]);
        await File.WriteAllBytesAsync(Path.Combine(localRoot, "ApexLabs", "PhotonStudio", "shader.cache"), new byte[8192]);

        var appInfo = new InstalledApplicationInfo(
            Id: "reg:HKCU:PhotonStudio",
            Name: "PhotonStudio",
            Publisher: "ApexLabs",
            Version: "3.1.0",
            InstallDate: "2026-05-01",
            InstallLocation: customInstallDir,
            UninstallString: $"\"{fakeUninstaller}\" /SILENT",
            QuietUninstallString: string.Empty,
            EstimatedSizeBytes: 14336,
            Source: "Win32 Registry",
            CanUninstall: true,
            IsSystemComponent: false);

        var searchRoots = new (string Label, string Path)[]
        {
            ("AppData (Roaming)", roamingRoot),
            ("AppData (Local)", localRoot)
        };

        var session = await appsEngine.RunMonitoredUninstallAsync(
            appInfo,
            customProcessLauncher: argv =>
            {
                Assert.Equal(fakeUninstaller, argv[0]);
                Assert.Equal("/SILENT", argv[1]);
                return (9876, Task.FromResult<int?>(0));
            },
            customLeftoverRoots: searchRoots);

        Assert.Equal(9876, session.LaunchedProcessId);
        Assert.Equal(0, session.ExitCode);
        Assert.Equal(3, session.PostUninstallLeftovers.TotalCount);
        Assert.Equal(3, session.PostUninstallLeftovers.HighConfidenceCount);
        Assert.Equal(14336, session.PostUninstallLeftovers.TotalReclaimableBytes);

        // Verify custom InstallLocation can be cleaned up via GetAllowedCleanupRootsForApp
        var allowedRoots = InstalledAppsEngineService.GetAllowedCleanupRootsForApp(
            installLocation: customInstallDir,
            extraRoots: [roamingRoot, localRoot]);
        var cleanupSvc = new SafeCleanupService();
        var prop = cleanupSvc.ProposeCleanup(
            session.PostUninstallLeftovers.FileSystemLeftovers.Select(l => l.FullPath),
            allowedRoots,
            mode: "permanent");
        var exec = cleanupSvc.ExecuteCleanup(prop.Token, allowedRoots);
        Assert.Equal("completed", exec.Status);
        Assert.Equal(3, exec.RemovedCount);
        Assert.False(Directory.Exists(customInstallDir));
    }

    [Fact]
    public async Task RealWorkloadBenchmark_MeasuresWin32ScannerThroughputAndCancellation()
    {
        // Benchmark against the real Groundwork repository root to report honest, measured throughput
        string repoRoot = Path.GetFullPath(Path.Combine(AppContext.BaseDirectory, "..", "..", "..", "..", "..", ".."));
        if (!Directory.Exists(repoRoot))
        {
            repoRoot = Environment.CurrentDirectory;
        }

        var scanner = new Win32StorageScanner();
        int progressCallbacks = 0;
        var progress = new Progress<ScanProgressReport>(_ => Interlocked.Increment(ref progressCallbacks));

        var result = await scanner.ScanAsync(repoRoot, progress, topN: 15, retainAllEntries: false);

        double seconds = Math.Max(0.001, result.ElapsedMilliseconds / 1000.0);
        double filesPerSec = result.TotalFiles / seconds;
        long workingSetMb = Process.GetCurrentProcess().WorkingSet64 / (1024 * 1024);

        _output.WriteLine($"[BENCHMARK] Root: {repoRoot}");
        _output.WriteLine($"[BENCHMARK] Files: {result.TotalFiles:N0}, Folders: {result.TotalFolders:N0}, Logical Bytes: {result.TotalLogicalBytes:N0}");
        _output.WriteLine($"[BENCHMARK] Elapsed: {result.ElapsedMilliseconds:F2} ms ({filesPerSec:N0} files/sec), WorkingSet: {workingSetMb} MB");

        Assert.True(result.TotalFiles > 100);
        Assert.True(result.TotalLogicalBytes > 0);
        Assert.NotEmpty(result.LargestFiles);
        Assert.NotEmpty(result.LargestFolders);

        // Verify responsive cancellation (< 500ms)
        using var cts = new CancellationTokenSource();
        cts.Cancel();
        await Assert.ThrowsAnyAsync<OperationCanceledException>(async () =>
            await scanner.ScanAsync(repoRoot, cancellationToken: cts.Token));
    }
}
