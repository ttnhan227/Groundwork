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
            var psi = new ProcessStartInfo
            {
                FileName = argv[0],
                UseShellExecute = false
            };
            foreach (var arg in argv.Skip(1))
            {
                psi.ArgumentList.Add(arg);
            }

            using var proc = Process.Start(psi)
                ?? throw new InvalidOperationException($"Windows could not start the uninstaller for '{app.Name}'.");
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
        IReadOnlyList<(string Label, string Path)>? customSearchRoots = null)
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

        var roots = customSearchRoots ?? DefaultLeftoverSearchRoots();
        var rootSet = new HashSet<string>(
            roots.Where(r => Directory.Exists(r.Path)).Select(r => Path.GetFullPath(r.Path).TrimEnd('\\')),
            StringComparer.OrdinalIgnoreCase);

        var fsLeftovers = new List<LeftoverFileSystemItem>();
        var seenPaths = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

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
                    ? BoundedDirectoryStats(full, maxFiles: 2500)
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

        // 1. Check explicit InstallLocation
        if (!string.IsNullOrWhiteSpace(installLocation))
        {
            try
            {
                string loc = installLocation.Trim().Trim('"');
                if (loc.EndsWith(".exe", StringComparison.OrdinalIgnoreCase) || loc.EndsWith(".dll", StringComparison.OrdinalIgnoreCase))
                {
                    loc = Path.GetDirectoryName(loc) ?? string.Empty;
                }
                if (!string.IsNullOrWhiteSpace(loc) && Directory.Exists(loc))
                {
                    AddCandidate(loc, "Install Directory", "high", $"Matches registered InstallLocation for '{cleanName}'");
                }
            }
            catch
            {
            }
        }

        // 2. Scan standard AppData / ProgramData / Program Files roots
        string primaryToken = appTokens.FirstOrDefault() ?? string.Empty;
        foreach (var (label, rootPath) in roots)
        {
            if (!Directory.Exists(rootPath))
            {
                continue;
            }

            try
            {
                foreach (var entryPath in Directory.EnumerateFileSystemEntries(rootPath))
                {
                    string entryName = Path.GetFileName(entryPath);
                    string entrySlug = Regex.Replace(entryName.ToLowerInvariant(), "[^a-z0-9]+", "");
                    if (string.IsNullOrEmpty(entrySlug))
                    {
                        continue;
                    }

                    if (appSlug.Length >= 3 && entrySlug == appSlug)
                    {
                        AddCandidate(entryPath, label, "high", $"Item in {label} exactly matches application name '{cleanName}'");
                        continue;
                    }

                    if (pubSlug.Length >= 3 && (entrySlug == pubSlug || (pubTokens.Count > 0 && entryName.Contains(pubTokens[0], StringComparison.OrdinalIgnoreCase))))
                    {
                        bool matchedChild = false;
                        if (Directory.Exists(entryPath))
                        {
                            try
                            {
                                foreach (var subPath in Directory.EnumerateFileSystemEntries(entryPath))
                                {
                                    string subName = Path.GetFileName(subPath);
                                    string subSlug = Regex.Replace(subName.ToLowerInvariant(), "[^a-z0-9]+", "");
                                    if ((appSlug.Length >= 3 && subSlug == appSlug) ||
                                        (primaryToken.Length >= 3 && subName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase)))
                                    {
                                        AddCandidate(subPath, label, "high", $"Nested under publisher folder '{entryName}' and matches '{cleanName}'");
                                        matchedChild = true;
                                    }
                                }
                            }
                            catch
                            {
                            }
                        }

                        if (!matchedChild && !isSharedVendor)
                        {
                            AddCandidate(entryPath, label, "review_required", $"Folder in {label} matches publisher '{cleanPub}'; verify no other apps from this publisher are installed");
                        }
                        continue;
                    }

                    if (primaryToken.Length >= 4 && entryName.Contains(primaryToken, StringComparison.OrdinalIgnoreCase))
                    {
                        var entryTokens = ExtractTokens(entryName);
                        bool exactTokens = appTokens.Count > 0 && entryTokens.SequenceEqual(appTokens, StringComparer.OrdinalIgnoreCase);
                        AddCandidate(
                            entryPath,
                            label,
                            exactTokens ? "high" : "review_required",
                            exactTokens
                                ? $"Name in {label} matches all tokens of '{cleanName}'"
                                : $"Name in {label} partially matches token '{primaryToken}' — review before deleting");
                    }
                }
            }
            catch
            {
            }
        }

        // 3. Read-only Registry Leftover Inspection (HKCU & HKLM, including WOW6432Node)
        var regLeftovers = new List<LeftoverRegistryItem>();
        if (OperatingSystem.IsWindows() && customSearchRoots == null)
        {
            var candidates = new List<(string SubKey, string Confidence, string Evidence)>();
            if (!string.IsNullOrEmpty(cleanPub) && !string.IsNullOrEmpty(cleanName))
            {
                candidates.Add(($@"Software\{cleanPub}\{cleanName}", "high", $"Registry key matches Publisher '{cleanPub}' and App '{cleanName}'"));
                candidates.Add(($@"Software\WOW6432Node\{cleanPub}\{cleanName}", "high", $"32-bit registry key matches Publisher '{cleanPub}' and App '{cleanName}'"));
            }
            if (!string.IsNullOrEmpty(cleanName))
            {
                candidates.Add(($@"Software\{cleanName}", "high", $"Registry key matches App '{cleanName}'"));
                candidates.Add(($@"Software\WOW6432Node\{cleanName}", "high", $"32-bit registry key matches App '{cleanName}'"));
            }
            if (!string.IsNullOrEmpty(cleanPub) && !isSharedVendor)
            {
                candidates.Add(($@"Software\{cleanPub}", "review_required", $"Vendor key matches Publisher '{cleanPub}' (shared across vendor apps)"));
                candidates.Add(($@"Software\WOW6432Node\{cleanPub}", "review_required", $"32-bit vendor key matches Publisher '{cleanPub}' (shared across vendor apps)"));
            }

            var seenReg = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
            foreach (var (hiveLabel, hiveKey) in new[] { ("HKCU", Registry.CurrentUser), ("HKLM", Registry.LocalMachine) })
            {
                foreach (var (subKey, conf, ev) in candidates)
                {
                    if (hiveLabel == "HKCU" && subKey.Contains("WOW6432Node", StringComparison.OrdinalIgnoreCase))
                    {
                        continue;
                    }
                    string fullKey = $@"{hiveLabel}\{subKey}";
                    if (!seenReg.Add(fullKey))
                    {
                        continue;
                    }
                    try
                    {
                        using var opened = hiveKey.OpenSubKey(subKey, writable: false);
                        if (opened != null)
                        {
                            regLeftovers.Add(new LeftoverRegistryItem(fullKey, conf, ev));
                        }
                    }
                    catch
                    {
                    }
                }
            }
        }

        var sortedFs = fsLeftovers
            .OrderBy(i => i.Confidence == "high" ? 0 : 1)
            .ThenByDescending(i => i.SizeBytes)
            .ThenBy(i => i.Name, StringComparer.OrdinalIgnoreCase)
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
            RegistryLeftovers: regLeftovers);
    }

    public static IReadOnlyList<(string Label, string Path)> DefaultLeftoverSearchRoots()
    {
        var roots = new List<(string Label, string Path)>();
        var candidates = new (string Label, string? RawPath)[]
        {
            ("AppData (Local)", Environment.GetEnvironmentVariable("LOCALAPPDATA")),
            ("AppData (Roaming)", Environment.GetEnvironmentVariable("APPDATA")),
            ("ProgramData", Environment.GetEnvironmentVariable("ProgramData")),
            ("Program Files", Environment.GetEnvironmentVariable("ProgramFiles")),
            ("Program Files (x86)", Environment.GetEnvironmentVariable("ProgramFiles(x86)"))
        };

        string? localAppData = Environment.GetEnvironmentVariable("LOCALAPPDATA");
        if (!string.IsNullOrWhiteSpace(localAppData))
        {
            string? parent = Path.GetDirectoryName(localAppData);
            if (!string.IsNullOrWhiteSpace(parent))
            {
                candidates = [.. candidates, ("AppData (LocalLow)", Path.Combine(parent, "LocalLow"))];
            }
        }

        var seen = new HashSet<string>(StringComparer.OrdinalIgnoreCase);
        foreach (var (label, raw) in candidates)
        {
            if (string.IsNullOrWhiteSpace(raw))
            {
                continue;
            }
            try
            {
                string full = Path.GetFullPath(raw);
                if (Directory.Exists(full) && seen.Add(full))
                {
                    roots.Add((label, full));
                }
            }
            catch
            {
            }
        }
        return roots;
    }

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
