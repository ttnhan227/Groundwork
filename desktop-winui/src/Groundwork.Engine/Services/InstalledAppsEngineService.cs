using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;
using Microsoft.Win32;

namespace Groundwork.Engine.Services;

public sealed class InstalledAppsEngineService
{
    private static readonly char[] UnsafeShellChars = ['&', '|', ';', '<', '>', '`', '\r', '\n'];
    private static readonly HashSet<string> GenericVendors = new(StringComparer.OrdinalIgnoreCase)
    {
        "microsoft", "microsoftcorporation", "google", "googlellc", "apple", "appleinc",
        "adobe", "valve", "common", "windows", "package"
    };

    private static readonly HashSet<string> StopWords = new(StringComparer.OrdinalIgnoreCase)
    {
        "the", "and", "for", "app", "application", "desktop", "client", "setup", "installer",
        "runtime", "redistributable", "x64", "x86", "edition", "version", "corp", "corporation", "inc", "llc", "ltd"
    };

    public IReadOnlyList<InstalledApplicationInfo> EnumerateInstalledApps(bool includeSystemComponents = false)
    {
        var apps = new List<InstalledApplicationInfo>();
        var seenKeys = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        if (!OperatingSystem.IsWindows())
        {
            return apps;
        }

        var registryTargets = new (RegistryKey Hive, string HiveName, string SubKeyPath)[]
        {
            (Registry.LocalMachine, "HKLM", @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"),
            (Registry.LocalMachine, "HKLM", @"SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall"),
            (Registry.CurrentUser, "HKCU", @"SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall")
        };

        foreach (var (hive, hiveName, subKeyPath) in registryTargets)
        {
            try
            {
                using var baseKey = hive.OpenSubKey(subKeyPath, writable: false);
                if (baseKey == null)
                {
                    continue;
                }

                foreach (var subName in baseKey.GetSubKeyNames())
                {
                    try
                    {
                        using var appKey = baseKey.OpenSubKey(subName, writable: false);
                        if (appKey == null)
                        {
                            continue;
                        }

                        string displayName = (appKey.GetValue("DisplayName") as string)?.Trim() ?? string.Empty;
                        if (string.IsNullOrWhiteSpace(displayName))
                        {
                            continue;
                        }

                        int sysComponent = Convert.ToInt32(appKey.GetValue("SystemComponent") ?? 0);
                        bool isSystem = sysComponent == 1;
                        if (isSystem && !includeSystemComponents)
                        {
                            continue;
                        }

                        string releaseType = (appKey.GetValue("ReleaseType") as string)?.Trim() ?? string.Empty;
                        if (releaseType.Equals("Security Update", StringComparison.OrdinalIgnoreCase) ||
                            releaseType.Equals("Update", StringComparison.OrdinalIgnoreCase) ||
                            releaseType.Equals("Hotfix", StringComparison.OrdinalIgnoreCase))
                        {
                            continue;
                        }

                        string rawPublisher = (appKey.GetValue("Publisher") as string)?.Trim() ?? string.Empty;
                        string publisher = CleanPublisher(rawPublisher);
                        string version = (appKey.GetValue("DisplayVersion") as string)?.Trim() ?? string.Empty;
                        string rawDate = (appKey.GetValue("InstallDate") as string)?.Trim() ?? string.Empty;
                        string installDate = NormalizeInstallDate(rawDate);
                        string installLocation = (appKey.GetValue("InstallLocation") as string)?.Trim().Trim('"') ?? string.Empty;
                        string uninstallString = (appKey.GetValue("UninstallString") as string)?.Trim() ?? string.Empty;
                        string quietUninstall = (appKey.GetValue("QuietUninstallString") as string)?.Trim() ?? string.Empty;
                        string displayIcon = (appKey.GetValue("DisplayIcon") as string)?.Trim() ?? string.Empty;
                        string iconPngPath = AppIconService.ExtractAndCacheIcon(displayIcon, installLocation) ?? string.Empty;

                        long? estimatedBytes = null;
                        object? rawSize = appKey.GetValue("EstimatedSize");
                        if (rawSize != null && long.TryParse(rawSize.ToString(), out long sizeKb) && sizeKb > 0)
                        {
                            estimatedBytes = sizeKb * 1024L;
                        }
                        else if (!string.IsNullOrWhiteSpace(installLocation) && Directory.Exists(installLocation))
                        {
                            var (dirBytes, _) = BoundedDirectoryStats(installLocation, maxFiles: 1500);
                            if (dirBytes > 0)
                            {
                                estimatedBytes = dirBytes;
                            }
                        }

                        string dedupeKey = $"{displayName.ToLowerInvariant()}|{version.ToLowerInvariant()}|{publisher.ToLowerInvariant()}";
                        if (!seenKeys.Add(dedupeKey))
                        {
                            continue;
                        }

                        bool canUninstall = false;
                        if (!string.IsNullOrWhiteSpace(uninstallString))
                        {
                            try
                            {
                                var parsed = ParseUninstallCommand(uninstallString);
                                canUninstall = parsed.Count > 0;
                            }
                            catch
                            {
                                canUninstall = false;
                            }
                        }

                        apps.Add(new InstalledApplicationInfo(
                            Id: $"reg:{hiveName}:{subName}",
                            Name: displayName,
                            Publisher: publisher,
                            Version: version,
                            InstallDate: installDate,
                            InstallLocation: installLocation,
                            UninstallString: uninstallString,
                            QuietUninstallString: quietUninstall,
                            EstimatedSizeBytes: estimatedBytes,
                            Source: "Win32 Registry",
                            CanUninstall: canUninstall,
                            IsSystemComponent: isSystem,
                            IconPngPath: iconPngPath));
                    }
                    catch
                    {
                        // Skip inaccessible registry entry
                    }
                }
            }
            catch
            {
                // Skip inaccessible hive
            }
        }

        return apps
            .OrderByDescending(a => a.EstimatedSizeBytes ?? -1L)
            .ThenBy(a => a.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    public static IReadOnlyList<string> ParseUninstallCommand(string rawCommand)
    {
        if (string.IsNullOrWhiteSpace(rawCommand) || rawCommand.Length > 2048)
        {
            throw new ArgumentException("Uninstall command is empty or invalid.");
        }

        if (rawCommand.IndexOfAny(UnsafeShellChars) >= 0)
        {
            throw new ArgumentException("Uninstall command contains unsafe shell operators.");
        }

        string trimmed = rawCommand.Trim();

        // Match MSI product code uninstalls
        var msiMatch = Regex.Match(
            trimmed,
            @"^(?:""?[^\s""]*msiexec(?:\.exe)?""?)\s+(/[IUXiux])\s*(\{[0-9A-Fa-f\-]{36}\})(.*)$",
            RegexOptions.IgnoreCase);
        if (msiMatch.Success)
        {
            string productCode = msiMatch.Groups[2].Value;
            string sysMsiExec = Path.Combine(Environment.SystemDirectory, "msiexec.exe");
            return [sysMsiExec, $"/X{productCode}"];
        }

        var args = SplitWindowsCommandLine(trimmed);
        if (args.Count == 0)
        {
            throw new ArgumentException("Could not parse executable from uninstall command.");
        }

        string exeCandidate = Environment.ExpandEnvironmentVariables(args[0].Trim('"'));
        string ext = Path.GetExtension(exeCandidate);
        if (!ext.Equals(".exe", StringComparison.OrdinalIgnoreCase))
        {
            throw new ArgumentException($"Unsupported uninstaller executable type '{ext}'.");
        }

        if (Path.IsPathRooted(exeCandidate) && File.Exists(exeCandidate))
        {
            args[0] = Path.GetFullPath(exeCandidate);
            return args;
        }

        // Handle unquoted paths containing spaces (e.g., C:\Program Files\App\uninstall.exe /S)
        int exeIdx = trimmed.IndexOf(".exe", StringComparison.OrdinalIgnoreCase);
        if (exeIdx > 0)
        {
            string prefixExe = Environment.ExpandEnvironmentVariables(trimmed.Substring(0, exeIdx + 4).Trim('"'));
            if (Path.IsPathRooted(prefixExe) && File.Exists(prefixExe))
            {
                string remainder = trimmed.Substring(exeIdx + 4).Trim();
                var result = new List<string> { Path.GetFullPath(prefixExe) };
                if (!string.IsNullOrEmpty(remainder))
                {
                    result.AddRange(SplitWindowsCommandLine(remainder));
                }
                return result;
            }
        }

        throw new FileNotFoundException($"Uninstaller executable not found on disk: '{exeCandidate}'");
    }

    public async Task<UninstallSessionResult> RunMonitoredUninstallAsync(
        InstalledApplicationInfo app,
        Func<IReadOnlyList<string>, (int Pid, Task<int?> WaitExit)>? customProcessLauncher = null,
        IReadOnlyList<(string Label, string Path)>? customLeftoverRoots = null,
        CancellationToken cancellationToken = default)
    {
        var argv = ParseUninstallCommand(app.UninstallString);

        int pid;
        int? exitCode;

        if (customProcessLauncher != null)
        {
            var launched = customProcessLauncher(argv);
            pid = launched.Pid;
            exitCode = await launched.WaitExit.ConfigureAwait(false);
        }
        else
        {
            using var proc = LaunchUninstallerProcess(app.UninstallString);
            pid = proc.Id;

            using var timeoutCts = CancellationTokenSource.CreateLinkedTokenSource(cancellationToken);
            timeoutCts.CancelAfter(TimeSpan.FromMinutes(10));
            try
            {
                await proc.WaitForExitAsync(timeoutCts.Token).ConfigureAwait(false);
                exitCode = proc.ExitCode;
            }
            catch (OperationCanceledException)
            {
                exitCode = null;
            }
        }

        bool stillRegistered = EnumerateInstalledApps()
            .Any(a => string.Equals(a.Id, app.Id, StringComparison.OrdinalIgnoreCase) ||
                      string.Equals(a.Name, app.Name, StringComparison.OrdinalIgnoreCase));

        var leftovers = ScanAppLeftovers(
            appId: app.Id,
            appName: app.Name,
            publisher: app.Publisher,
            installLocation: app.InstallLocation,
            customSearchRoots: customLeftoverRoots);

        return new UninstallSessionResult(
            AppId: app.Id,
            AppName: app.Name,
            LaunchedProcessId: pid,
            ExitCode: exitCode,
            StillRegisteredAfterExit: stillRegistered,
            PostUninstallLeftovers: leftovers);
    }

    public AppLeftoverReport ScanAppLeftovers(
        string appId,
        string appName,
        string publisher = "",
        string installLocation = "",
        IReadOnlyList<(string Label, string Path)>? customSearchRoots = null,
        bool includeInstallLocation = true,
        LeftoverScanDepth scanDepth = LeftoverScanDepth.Moderate,
        string uninstallString = "")
    {
        string cleanName = (appName ?? string.Empty).Trim();
        if (cleanName.Length < 2)
        {
            throw new ArgumentException("Application name must be at least 2 characters to scan for leftovers.", nameof(appName));
        }

        string cleanPub = CleanPublisher(publisher);
        string appSlug = Regex.Replace(cleanName.ToLowerInvariant(), "[^a-z0-9]+", "");
        string pubSlug = Regex.Replace(cleanPub.ToLowerInvariant(), "[^a-z0-9]+", "");
        var appTokens = ExtractTokens(cleanName);
        var pubTokens = ExtractTokens(cleanPub);
        bool isSharedVendor = GenericVendors.Contains(cleanPub) || GenericVendors.Contains(pubSlug);

        string resolvedInstallDir = ResolveDirectoryPath(installLocation);
        string exeHintName = ExtractExecutableBaseName(installLocation, uninstallString);

        var roots = customSearchRoots ?? GetLeftoverSearchRootsForDepth(scanDepth);
        var rootSet = new HashSet<string>(
            roots.Where(r => Directory.Exists(r.Path)).Select(r => Path.GetFullPath(r.Path).TrimEnd('\\')),
            StringComparer.OrdinalIgnoreCase);

        var fsLeftovers = new List<LeftoverFileSystemItem>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        int inspectedLocations = roots.Count;

        void AddCandidate(string candidatePath, string groupLabel, string confidence, string evidence)
        {
            try
            {
                string full = Path.GetFullPath(candidatePath).TrimEnd('\\');
                if (!seenPaths.Add(full) || rootSet.Contains(full))
                {
                    return;
                }
                if (SafeCleanupService.IsProtectedSystemPath(full))
                {
                    return;
                }

                bool isDir = Directory.Exists(full);
                bool isFile = !isDir && File.Exists(full);
                if (!isDir && !isFile)
                {
                    return;
                }

                var (sizeBytes, fileCount) = isDir
                    ? BoundedDirectoryStats(full, maxFiles: scanDepth == LeftoverScanDepth.Advanced ? 6000 : 2500)
                    : (new FileInfo(full).Length, 1);

                fsLeftovers.Add(new LeftoverFileSystemItem(
                    FullPath: full,
                    Name: Path.GetFileName(full),
                    Kind: isDir ? "folder" : "file",
                    LocationGroup: groupLabel,
                    SizeBytes: sizeBytes,
                    FileCount: fileCount,
                    Confidence: confidence,
                    Evidence: evidence));
            }
            catch
            {
            }
        }

        // 1. Explicit InstallLocation directory
        if (includeInstallLocation && !string.IsNullOrWhiteSpace(resolvedInstallDir) && Directory.Exists(resolvedInstallDir))
        {
            inspectedLocations++;
            AddCandidate(resolvedInstallDir, "Install Directory", "high", $"Matches registered InstallLocation for '{cleanName}'");
        }

        // 2. Scan mode-scoped filesystem roots (AppData, ProgramData, Program Files, Shortcuts, Temp, CrashDumps, Prefetch, Documents)
        string primaryToken = appTokens.FirstOrDefault() ?? string.Empty;
        foreach (var (label, rootPath) in roots)
        {
            if (!Directory.Exists(rootPath))
            {
                continue;
            }

            try
            {
                bool isShortcutOrTempRoot = label.Contains("Start Menu", StringComparison.OrdinalIgnoreCase) ||
                                            label.Contains("Desktop", StringComparison.OrdinalIgnoreCase) ||
                                            label.Contains("Temp", StringComparison.OrdinalIgnoreCase) ||
                                            label.Contains("Prefetch", StringComparison.OrdinalIgnoreCase) ||
                                            label.Contains("CrashDumps", StringComparison.OrdinalIgnoreCase);

                foreach (var entryPath in Directory.EnumerateFileSystemEntries(rootPath))
                {
                    inspectedLocations++;
                    string entryName = Path.GetFileName(entryPath);
                    string entryBase = Path.GetFileNameWithoutExtension(entryName);
                    string entrySlug = Regex.Replace(entryBase.ToLowerInvariant(), "[^a-z0-9]+", "");
                    if (string.IsNullOrEmpty(entrySlug))
                    {
                        continue;
                    }

                    // Special Prefetch / CrashDump executable trace matching (Advanced mode)
                    if ((label.Contains("Prefetch", StringComparison.OrdinalIgnoreCase) ||
                         label.Contains("CrashDumps", StringComparison.OrdinalIgnoreCase)) &&
                        exeHintName.Length >= 3)
                    {
                        if (entryBase.Contains(exeHintName, StringComparison.OrdinalIgnoreCase) ||
                            (appSlug.Length >= 4 && entrySlug.Contains(appSlug, StringComparison.OrdinalIgnoreCase)))
                        {
                            AddCandidate(entryPath, label, "high", $"{label} trace matches '{cleanName}' executable ({exeHintName})");
                        }
                        continue;
                    }

                    if (appSlug.Length >= 3 && entrySlug == appSlug)
                    {
                        AddCandidate(entryPath, label, "high", $"Item in {label} exactly matches application name '{cleanName}'");
                        continue;
                    }

                    // Publisher / Common Files parent container: inspect children cleanly
                    bool matchesVendorOrCommon =
                        (pubSlug.Length >= 3 && (entrySlug == pubSlug || (pubTokens.Count > 0 && entryName.Contains(pubTokens[0], StringComparison.OrdinalIgnoreCase)))) ||
                        (scanDepth == LeftoverScanDepth.Advanced && entryName.Equals("Common Files", StringComparison.OrdinalIgnoreCase)) ||
                        (label.Contains("Start Menu", StringComparison.OrdinalIgnoreCase) && Directory.Exists(entryPath));

                    if (matchesVendorOrCommon && Directory.Exists(entryPath))
                    {
                        bool matchedChild = ScanNestedLeftovers(
                            entryPath,
                            label,
                            cleanName,
                            appSlug,
                            primaryToken,
                            exeHintName,
                            maxDepth: scanDepth == LeftoverScanDepth.Advanced ? 2 : 1,
                            AddCandidate);

                        if (!matchedChild && !isSharedVendor && pubSlug.Length >= 3 && entrySlug == pubSlug && scanDepth != LeftoverScanDepth.Safe)
                        {
                            AddCandidate(entryPath, label, "review_required", $"Folder in {label} matches publisher '{cleanPub}'; verify no other apps from this publisher are installed");
                        }
                        continue;
                    }

                    // Moderate & Advanced: multi-token or partial app name match
                    if (scanDepth != LeftoverScanDepth.Safe && primaryToken.Length >= 4 && entryName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase))
                    {
                        var entryTokens = ExtractTokens(entryBase);
                        bool exactTokens = appTokens.Count > 0 && entryTokens.SequenceEqual(appTokens, StringComparer.OrdinalIgnoreCase);
                        bool isShortcutMatch = isShortcutOrTempRoot && (entrySlug.Contains(appSlug, StringComparison.OrdinalIgnoreCase) || exactTokens);

                        if (!exactTokens && appTokens.Count >= 2 && scanDepth == LeftoverScanDepth.Moderate && !isShortcutMatch)
                        {
                            continue;
                        }

                        AddCandidate(
                            entryPath,
                            label,
                            (exactTokens || isShortcutMatch) ? "high" : "review_required",
                            (exactTokens || isShortcutMatch)
                                ? $"Item in {label} matches '{cleanName}'"
                                : $"Item in {label} partially matches '{primaryToken}' — review before deleting");
                    }
                    else if (scanDepth == LeftoverScanDepth.Advanced && exeHintName.Length >= 4 &&
                             entryBase.Equals(exeHintName, StringComparison.OrdinalIgnoreCase))
                    {
                        AddCandidate(entryPath, label, "review_required", $"Item in {label} matches executable '{exeHintName}' — review before deleting");
                    }
                }
            }
            catch
            {
            }
        }

        // 3. Read-only Registry Leftover Inspection (mode-aware)
        var regLeftovers = new List<LeftoverRegistryItem>();
        if (OperatingSystem.IsWindows() && customSearchRoots == null)
        {
            inspectedLocations += ScanRegistryLeftoversByDepth(
                appId, cleanName, cleanPub, appSlug, pubSlug, primaryToken, isSharedVendor,
                resolvedInstallDir, exeHintName, scanDepth, regLeftovers);
        }

        var sortedFs = fsLeftovers
            .OrderBy(i => i.Confidence == "high" ? 0 : 1)
            .ThenByDescending(i => i.SizeBytes)
            .ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase)
            .ToList();

        var sortedReg = regLeftovers
            .OrderBy(r => r.Confidence == "high" ? 0 : 1)
            .ThenBy(r => r.LocationGroup, StringComparer.OrdinalIgnoreCase)
            .ThenBy(r => r.KeyPath, StringComparer.OrdinalIgnoreCase)
            .ToList();

        return new AppLeftoverReport(
            AppId: appId,
            AppName: cleanName,
            Publisher: cleanPub,
            InstallLocation: installLocation,
            TotalCount: sortedFs.Count,
            HighConfidenceCount: sortedFs.Count(i => i.Confidence == "high"),
            ReviewRequiredCount: sortedFs.Count(i => i.Confidence != "high"),
            TotalReclaimableBytes: sortedFs.Sum(i => i.SizeBytes),
            HighConfidenceBytes: sortedFs.Where(i => i.Confidence == "high").Sum(i => i.SizeBytes),
            FileSystemLeftovers: sortedFs,
            RegistryLeftovers: sortedReg,
            ScanDepth: scanDepth,
            InspectedLocationCount: inspectedLocations);
    }

    private static bool ScanNestedLeftovers(
        string parentDir,
        string groupLabel,
        string cleanName,
        string appSlug,
        string primaryToken,
        string exeHintName,
        int maxDepth,
        Action<string, string, string, string> addCandidate,
        int currentDepth = 1)
    {
        bool matchedAny = false;
        try
        {
            foreach (var subPath in Directory.EnumerateFileSystemEntries(parentDir))
            {
                string subName = Path.GetFileName(subPath);
                string subBase = Path.GetFileNameWithoutExtension(subName);
                string subSlug = Regex.Replace(subBase.ToLowerInvariant(), "[^a-z0-9]+", "");
                bool exact = (appSlug.Length >= 3 && subSlug == appSlug) ||
                             (exeHintName.Length >= 4 && subSlug.Equals(exeHintName, StringComparison.OrdinalIgnoreCase));
                bool tokenHit = primaryToken.Length >= 4 && subName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase);

                if (exact || tokenHit)
                {
                    addCandidate(
                        subPath,
                        groupLabel,
                        exact ? "high" : "review_required",
                        $"Nested under '{Path.GetFileName(parentDir)}' and matches '{cleanName}'");
                    matchedAny = true;
                }
                else if (currentDepth < maxDepth && Directory.Exists(subPath))
                {
                    if (ScanNestedLeftovers(subPath, groupLabel, cleanName, appSlug, primaryToken, exeHintName, maxDepth, addCandidate, currentDepth + 1))
                    {
                        matchedAny = true;
                    }
                }
            }
        }
        catch
        {
        }
        return matchedAny;
    }

    private static int ScanRegistryLeftoversByDepth(
        string appId,
        string cleanName,
        string cleanPub,
        string appSlug,
        string pubSlug,
        string primaryToken,
        bool isSharedVendor,
        string resolvedInstallDir,
        string exeHintName,
        LeftoverScanDepth scanDepth,
        List<LeftoverRegistryItem> results)
    {
        int inspected = 0;
        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        void AddReg(string keyOrValueSpec, string confidence, string evidence, string entryKind = "Key", string group = "Software")
        {
            if (seen.Add(keyOrValueSpec))
            {
                results.Add(new LeftoverRegistryItem(keyOrValueSpec, confidence, evidence, entryKind, group));
            }
        }

        // Direct Software & WOW6432Node candidates
        var directCandidates = new List<(string SubKey, string Confidence, string Evidence, bool ModerateOrHigher)>();
        if (!string.IsNullOrEmpty(cleanPub) && !string.IsNullOrEmpty(cleanName))
        {
            directCandidates.Add(($@"Software\{cleanPub}\{cleanName}", "high", $"Registry key matches Publisher '{cleanPub}' and App '{cleanName}'", false));
            directCandidates.Add(($@"Software\WOW6432Node\{cleanPub}\{cleanName}", "high", $"32-bit registry key matches Publisher '{cleanPub}' and App '{cleanName}'", true));
        }
        if (!string.IsNullOrEmpty(cleanName))
        {
            directCandidates.Add(($@"Software\{cleanName}", "high", $"Registry key matches App '{cleanName}'", false));
            directCandidates.Add(($@"Software\WOW6432Node\{cleanName}", "high", $"32-bit registry key matches App '{cleanName}'", true));
        }
        if (!string.IsNullOrEmpty(cleanPub) && !isSharedVendor)
        {
            directCandidates.Add(($@"Software\{cleanPub}", "review_required", $"Vendor key matches Publisher '{cleanPub}' (may contain sibling apps)", true));
            directCandidates.Add(($@"Software\WOW6432Node\{cleanPub}", "review_required", $"32-bit vendor key matches Publisher '{cleanPub}'", true));
        }

        foreach (var (hiveLabel, hiveKey) in new[] { ("HKCU", Registry.CurrentUser), ("HKLM", Registry.LocalMachine) })
        {
            foreach (var (subKey, conf, ev, moderateOrHigher) in directCandidates)
            {
                if (moderateOrHigher && scanDepth == LeftoverScanDepth.Safe) continue;
                if (hiveLabel == "HKCU" && subKey.Contains("WOW6432Node", StringComparison.OrdinalIgnoreCase)) continue;

                inspected++;
                try
                {
                    using var opened = hiveKey.OpenSubKey(subKey, writable: false);
                    if (opened != null)
                    {
                        AddReg($@"{hiveLabel}\{subKey}", conf, ev, "Key", hiveLabel == "HKCU" ? "User Software" : "Machine Software");
                    }
                }
                catch { }
            }
        }

        if (scanDepth != LeftoverScanDepth.Advanced)
        {
            return inspected;
        }

        // ADVANCED SCAN: Sweep everything safely across deeper Software subtrees, App Paths, Uninstall remnants,
        // custom Classes protocols, Third-party Services, Run startup values, MuiCache, and AppCompatFlags
        foreach (var (hiveLabel, hiveKey, swPath) in new[]
        {
            ("HKCU", Registry.CurrentUser, "Software"),
            ("HKLM", Registry.LocalMachine, "Software"),
            ("HKLM", Registry.LocalMachine, @"Software\WOW6432Node")
        })
        {
            try
            {
                using var sw = hiveKey.OpenSubKey(swPath, writable: false);
                if (sw == null) continue;
                foreach (var topName in sw.GetSubKeyNames())
                {
                    inspected++;
                    if (topName.Equals("Microsoft", StringComparison.OrdinalIgnoreCase) ||
                        topName.Equals("Classes", StringComparison.OrdinalIgnoreCase) ||
                        topName.Equals("Policies", StringComparison.OrdinalIgnoreCase) ||
                        topName.Equals("WOW6432Node", StringComparison.OrdinalIgnoreCase) ||
                        topName.Equals("Groundwork", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }

                    string topSlug = Regex.Replace(topName.ToLowerInvariant(), "[^a-z0-9]+", "");
                    if ((appSlug.Length >= 4 && topSlug == appSlug) ||
                        (primaryToken.Length >= 5 && topName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase)))
                    {
                        AddReg($@"{hiveLabel}\{swPath}\{topName}",
                            topSlug == appSlug ? "high" : "review_required",
                            $"Deep Software sweep matched '{topName}'",
                            "Key",
                            "Deep Software");
                        continue;
                    }

                    // Inspect nested children under vendor keys (e.g. Software\<Vendor>\<Product>)
                    try
                    {
                        using var vendorKey = sw.OpenSubKey(topName, writable: false);
                        if (vendorKey == null) continue;
                        foreach (var childName in vendorKey.GetSubKeyNames())
                        {
                            inspected++;
                            string childSlug = Regex.Replace(childName.ToLowerInvariant(), "[^a-z0-9]+", "");
                            if ((appSlug.Length >= 3 && childSlug == appSlug) ||
                                (primaryToken.Length >= 4 && childName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase)))
                            {
                                AddReg($@"{hiveLabel}\{swPath}\{topName}\{childName}",
                                    childSlug == appSlug ? "high" : "review_required",
                                    $"Deep Software subkey '{topName}\\{childName}' matches '{cleanName}'",
                                    "Key",
                                    "Deep Software");
                            }
                        }
                    }
                    catch { }
                }
            }
            catch { }
        }

        // Leftover Uninstall registry entry (if appId starts with reg:)
        if (appId.StartsWith("reg:", StringComparison.OrdinalIgnoreCase))
        {
            var parts = appId.Split(':', 3);
            if (parts.Length == 3 && !string.IsNullOrWhiteSpace(parts[2]))
            {
                string subName = parts[2];
                var targets = new[]
                {
                    ("HKCU", Registry.CurrentUser, $@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{subName}"),
                    ("HKLM", Registry.LocalMachine, $@"Software\Microsoft\Windows\CurrentVersion\Uninstall\{subName}"),
                    ("HKLM", Registry.LocalMachine, $@"Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\{subName}")
                };
                foreach (var (hiveLabel, hive, uninstPath) in targets)
                {
                    inspected++;
                    try
                    {
                        using var k = hive.OpenSubKey(uninstPath, writable: false);
                        if (k != null)
                        {
                            AddReg($@"{hiveLabel}\{uninstPath}", "review_required",
                                $"Registered Uninstall entry still present for '{cleanName}' (check if already removed).",
                                "Key", "Uninstall Remnant");
                        }
                    }
                    catch { }
                }
            }
        }

        // App Paths executable registration
        foreach (var (hiveLabel, hive) in new[] { ("HKCU", Registry.CurrentUser), ("HKLM", Registry.LocalMachine) })
        {
            try
            {
                using var appPaths = hive.OpenSubKey(@"Software\Microsoft\Windows\CurrentVersion\App Paths", writable: false);
                if (appPaths == null) continue;
                foreach (var sub in appPaths.GetSubKeyNames())
                {
                    inspected++;
                    string subBase = Path.GetFileNameWithoutExtension(sub);
                    string subSlug = Regex.Replace(subBase.ToLowerInvariant(), "[^a-z0-9]+", "");
                    bool matchesExe = exeHintName.Length >= 4 && subBase.Equals(exeHintName, StringComparison.OrdinalIgnoreCase);
                    bool matchesApp = appSlug.Length >= 4 && subSlug == appSlug;

                    using var entry = appPaths.OpenSubKey(sub, writable: false);
                    string? pathVal = entry?.GetValue(null)?.ToString() ?? entry?.GetValue("Path")?.ToString();
                    bool matchesDir = !string.IsNullOrWhiteSpace(resolvedInstallDir) && !string.IsNullOrWhiteSpace(pathVal) &&
                                      pathVal.Contains(resolvedInstallDir, StringComparison.OrdinalIgnoreCase);

                    if (matchesExe || matchesApp || matchesDir)
                    {
                        AddReg($@"{hiveLabel}\Software\Microsoft\Windows\CurrentVersion\App Paths\{sub}",
                            matchesDir || matchesExe ? "high" : "review_required",
                            $"App Paths entry '{sub}' points to '{cleanName}'",
                            "Key",
                            "App Paths");
                    }
                }
            }
            catch { }
        }

        // Custom URL protocols / handlers under HKCU\Software\Classes matching exact appSlug
        if (appSlug.Length >= 4)
        {
            try
            {
                using var classes = Registry.CurrentUser.OpenSubKey(@"Software\Classes", writable: false);
                if (classes != null)
                {
                    foreach (var cls in classes.GetSubKeyNames())
                    {
                        inspected++;
                        if (cls.StartsWith(".", StringComparison.Ordinal) || cls.Equals("Local Settings", StringComparison.OrdinalIgnoreCase)) continue;
                        string clsSlug = Regex.Replace(cls.ToLowerInvariant(), "[^a-z0-9]+", "");
                        if (clsSlug == appSlug || (exeHintName.Length >= 4 && clsSlug == exeHintName))
                        {
                            AddReg($@"HKCU\Software\Classes\{cls}", "review_required",
                                $"User Classes handler/protocol '{cls}' matches '{cleanName}'",
                                "Key", "File / URL Handler");
                        }
                    }
                }
            }
            catch { }
        }

        // Leftover third-party Windows Services referencing InstallLocation
        if (!string.IsNullOrWhiteSpace(resolvedInstallDir))
        {
            try
            {
                using var services = Registry.LocalMachine.OpenSubKey(@"SYSTEM\CurrentControlSet\Services", writable: false);
                if (services != null)
                {
                    foreach (var svcName in services.GetSubKeyNames())
                    {
                        inspected++;
                        try
                        {
                            using var svcKey = services.OpenSubKey(svcName, writable: false);
                            string? imagePath = svcKey?.GetValue("ImagePath")?.ToString();
                            if (!string.IsNullOrWhiteSpace(imagePath) &&
                                imagePath.Contains(resolvedInstallDir, StringComparison.OrdinalIgnoreCase))
                            {
                                AddReg($@"HKLM\SYSTEM\CurrentControlSet\Services\{svcName}",
                                    "review_required",
                                    $"Windows Service '{svcName}' ImagePath points inside removed install folder.",
                                    "Key",
                                    "Service Trace");
                            }
                        }
                        catch { }
                    }
                }
            }
            catch { }
        }

        // Value-level traces: Run/RunOnce dead commands, MuiCache, AppCompatFlags
        var valueScopes = new (string HiveLabel, RegistryKey Hive, string SubKey, string Group)[]
        {
            ("HKCU", Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\Run", "Startup Entry"),
            ("HKCU", Registry.CurrentUser, @"Software\Microsoft\Windows\CurrentVersion\RunOnce", "Startup Entry"),
            ("HKLM", Registry.LocalMachine, @"Software\Microsoft\Windows\CurrentVersion\Run", "Startup Entry"),
            ("HKLM", Registry.LocalMachine, @"Software\Microsoft\Windows\CurrentVersion\RunOnce", "Startup Entry"),
            ("HKCU", Registry.CurrentUser, @"Software\Classes\Local Settings\Software\Microsoft\Windows\Shell\MuiCache", "MUI Shell Cache"),
            ("HKCU", Registry.CurrentUser, @"Software\Microsoft\Windows NT\CurrentVersion\AppCompatFlags\Layers", "Compatibility Layer")
        };

        foreach (var (hiveLabel, hive, subKey, group) in valueScopes)
        {
            try
            {
                using var k = hive.OpenSubKey(subKey, writable: false);
                if (k == null) continue;
                foreach (var valName in k.GetValueNames())
                {
                    if (string.IsNullOrEmpty(valName)) continue;
                    inspected++;
                    string valData = k.GetValue(valName)?.ToString() ?? string.Empty;

                    bool dirMatch = !string.IsNullOrWhiteSpace(resolvedInstallDir) &&
                        (valData.Contains(resolvedInstallDir, StringComparison.OrdinalIgnoreCase) ||
                         valName.Contains(resolvedInstallDir, StringComparison.OrdinalIgnoreCase));
                    bool nameMatch = primaryToken.Length >= 5 &&
                        (valName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase) ||
                         valData.Contains(cleanName, StringComparison.OrdinalIgnoreCase));

                    if (dirMatch || nameMatch)
                    {
                        AddReg($@"{hiveLabel}\{subKey}::{valName}",
                            dirMatch ? "high" : "review_required",
                            $"{group} value '{valName}' references '{cleanName}'",
                            "RegistryValue",
                            group);
                    }
                }
            }
            catch { }
        }

        return inspected;
    }

    private static string ResolveDirectoryPath(string rawLocation)
    {
        if (string.IsNullOrWhiteSpace(rawLocation)) return string.Empty;
        try
        {
            string loc = rawLocation.Trim().Trim('"');
            if (loc.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) ||
                loc.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
            {
                loc = Path.GetDirectoryName(loc) ?? string.Empty;
            }
            return loc;
        }
        catch
        {
            return string.Empty;
        }
    }

    private static string ExtractExecutableBaseName(string installLocation, string uninstallString)
    {
        try
        {
            if (!string.IsNullOrWhiteSpace(installLocation))
            {
                string cleanLoc = installLocation.Trim().Trim('"');
                if (cleanLoc.EndsWith(".exe", StringComparison.OrdinalIgnoreCase))
                {
                    return Path.GetFileNameWithoutExtension(cleanLoc);
                }
            }
            if (!string.IsNullOrWhiteSpace(uninstallString))
            {
                var argv = SplitWindowsCommandLine(uninstallString);
                if (argv.Count > 0)
                {
                    string exeName = Path.GetFileNameWithoutExtension(argv[0]);
                    if (!exeName.StartsWith("unins", StringComparison.OrdinalIgnoreCase) &&
                        !exeName.Equals("msiexec", StringComparison.OrdinalIgnoreCase) &&
                        !exeName.Contains("setup", StringComparison.OrdinalIgnoreCase))
                    {
                        return exeName;
                    }
                }
            }
        }
        catch { }
        return string.Empty;
    }

    public static IReadOnlyList<(string Label, string Path)> GetLeftoverSearchRootsForDepth(LeftoverScanDepth scanDepth)
    {
        var roots = new List<(string Label, string Path)>();
        string? localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        string? appDataParent = !string.IsNullOrWhiteSpace(localAppData) ? Path.GetDirectoryName(localAppData) : null;
        string? userProfile = Environment.GetFolderPath(Environment.SpecialFolder.UserProfile);
        string? windowsDir = Environment.GetEnvironmentVariable("SystemRoot");

        var candidates = new List<(string Label, string? RawPath)>
        {
            ("AppData (Local)", localAppData),
            ("AppData (Roaming)", Environment.GetEnvironmentVariable("APPDATA")),
            ("ProgramData", Environment.GetEnvironmentVariable("ProgramData")),
            ("Program Files", Environment.GetEnvironmentVariable("ProgramFiles")),
            ("Program Files (x86)", Environment.GetEnvironmentVariable("ProgramFiles(x86)")),
            ("AppData (LocalLow)", !string.IsNullOrWhiteSpace(appDataParent) ? Path.Combine(appDataParent, "LocalLow") : null)
        };

        if (scanDepth is LeftoverScanDepth.Moderate or LeftoverScanDepth.Advanced)
        {
            candidates.Add(("Start Menu (User)", Environment.GetFolderPath(Environment.SpecialFolder.Programs)));
            candidates.Add(("Start Menu (All Users)", Environment.GetFolderPath(Environment.SpecialFolder.CommonPrograms)));
            candidates.Add(("Desktop (User)", Environment.GetFolderPath(Environment.SpecialFolder.DesktopDirectory)));
            candidates.Add(("Desktop (Public)", Environment.GetFolderPath(Environment.SpecialFolder.CommonDesktopDirectory)));
            candidates.Add(("Temp", Path.GetTempPath()));
        }

        if (scanDepth == LeftoverScanDepth.Advanced)
        {
            candidates.Add(("Common Files", !string.IsNullOrWhiteSpace(Environment.GetEnvironmentVariable("CommonProgramFiles"))
                ? Environment.GetEnvironmentVariable("CommonProgramFiles")
                : null));
            candidates.Add(("Common Files (x86)", Environment.GetEnvironmentVariable("CommonProgramFiles(x86)")));
            candidates.Add(("Documents", Environment.GetFolderPath(Environment.SpecialFolder.MyDocuments)));
            candidates.Add(("Public Documents", Environment.GetFolderPath(Environment.SpecialFolder.CommonDocuments)));
            if (!string.IsNullOrWhiteSpace(localAppData))
            {
                candidates.Add(("CrashDumps", Path.Combine(localAppData, "CrashDumps")));
            }
            if (!string.IsNullOrWhiteSpace(windowsDir))
            {
                candidates.Add(("Prefetch", Path.Combine(windowsDir, "Prefetch")));
            }
            if (!string.IsNullOrWhiteSpace(userProfile))
            {
                candidates.Add(("Saved Games", Path.Combine(userProfile, "Saved Games")));
            }
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (label, raw) in candidates)
        {
            if (string.IsNullOrWhiteSpace(raw)) continue;
            try
            {
                string full = Path.GetFullPath(raw);
                if (Directory.Exists(full) && seen.Add(full))
                {
                    roots.Add((label, full));
                }
            }
            catch { }
        }
        return roots;
    }

    public static IReadOnlyList<(string Label, string Path)> DefaultLeftoverSearchRoots() =>
        GetLeftoverSearchRootsForDepth(LeftoverScanDepth.Moderate);

    public static IReadOnlyList<string> GetAllowedCleanupRootsForApp(
        string installLocation = "",
        IEnumerable<string>? extraRoots = null)
    {
        var roots = DefaultLeftoverSearchRoots().Select(r => r.Path).ToList();
        if (extraRoots != null)
        {
            roots.AddRange(extraRoots);
        }
        if (!string.IsNullOrWhiteSpace(installLocation))
        {
            try
            {
                string clean = installLocation.Trim().Trim('"');
                if (clean.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || clean.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                {
                    clean = Path.GetDirectoryName(clean) ?? string.Empty;
                }
                string full = Path.GetFullPath(clean).TrimEnd('\\');
                string? parent = Path.GetDirectoryName(full);
                if (!string.IsNullOrWhiteSpace(parent) && !SafeCleanupService.IsProtectedSystemPath(full))
                {
                    roots.Add(parent);
                }
            }
            catch
            {
            }
        }
        return roots.Distinct(StringComparer.OrdinalIgnoreCase).ToList();
    }

    private static string CleanPublisher(string raw)
    {
        if (string.IsNullOrWhiteSpace(raw))
        {
            return string.Empty;
        }
        var cnMatch = Regex.Match(raw, @"CN=([^,]+)");
        return cnMatch.Success ? cnMatch.Groups[1].Value.Trim().Trim('"') : raw.Trim();
    }

    private static string NormalizeInstallDate(string raw)
    {
        if (raw.Length == 8 && raw.All(char.IsDigit))
        {
            return $"{raw[..4]}-{raw[4..6]}-{raw[6..8]}";
        }
        return raw;
    }

    private static IReadOnlyList<string> ExtractTokens(string text)
    {
        if (string.IsNullOrWhiteSpace(text))
        {
            return Array.Empty<string>();
        }
        return Regex.Matches(text.ToLowerInvariant(), "[a-z0-9]{3,}")
            .Select(m => m.Value)
            .Where(t => !StopWords.Contains(t) && !t.All(char.IsDigit))
            .Distinct(StringComparer.OrdinalIgnoreCase)
            .ToList();
    }

    private static (long Bytes, int Count) BoundedDirectoryStats(string dirPath, int maxFiles)
    {
        long totalBytes = 0;
        int count = 0;
        var stack = new Stack<string>();
        stack.Push(dirPath);

        while (stack.Count > 0 && count < maxFiles)
        {
            string current = stack.Pop();
            try
            {
                foreach (var file in Directory.EnumerateFiles(current))
                {
                    try
                    {
                        var fi = new FileInfo(file);
                        if ((fi.Attributes & FileAttributes.ReparsePoint) == 0)
                        {
                            totalBytes += fi.Length;
                            count++;
                            if (count >= maxFiles)
                            {
                                break;
                            }
                        }
                    }
                    catch
                    {
                    }
                }

                foreach (var sub in Directory.EnumerateDirectories(current))
                {
                    try
                    {
                        var di = new DirectoryInfo(sub);
                        if ((di.Attributes & FileAttributes.ReparsePoint) == 0)
                        {
                            stack.Push(sub);
                        }
                    }
                    catch
                    {
                    }
                }
            }
            catch
            {
            }
        }
        return (totalBytes, count);
    }

    public static Process LaunchUninstallerProcess(string rawUninstallCommand)
    {
        var argv = ParseUninstallCommand(rawUninstallCommand);
        var psi = new ProcessStartInfo
        {
            FileName = argv[0],
            Arguments = string.Join(" ", argv.Skip(1).Select(QuoteWindowsArgument)),
            UseShellExecute = true
        };
        return Process.Start(psi)
            ?? throw new InvalidOperationException("Windows could not start the uninstaller executable.");
    }

    private static string QuoteWindowsArgument(string arg) =>
        string.IsNullOrEmpty(arg) ? "\"\"" :
        (arg.Contains(' ') || arg.Contains('\t') ? $"\"{arg.Replace("\"", "\\\"")}\"" : arg);

    private static List<string> SplitWindowsCommandLine(string commandLine)
    {
        var result = new List<string>();
        bool inQuotes = false;
        var current = new System.Text.StringBuilder();

        for (int i = 0; i < commandLine.Length; i++)
        {
            char c = commandLine[i];
            if (c == '"')
            {
                inQuotes = !inQuotes;
            }
            else if (char.IsWhiteSpace(c) && !inQuotes)
            {
                if (current.Length > 0)
                {
                    result.Add(current.ToString());
                    current.Clear();
                }
            }
            else
            {
                current.Append(c);
            }
        }

        if (current.Length > 0)
        {
            result.Add(current.ToString());
        }

        return result;
    }
}
