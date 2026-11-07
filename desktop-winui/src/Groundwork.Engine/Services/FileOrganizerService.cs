using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using Groundwork.Engine.Models;

namespace Groundwork.Engine.Services;

/// <summary>
/// Previews and executes reversible folder organization into structured category subfolders,
/// integrated with <see cref="SafeOperationEngine"/> and <see cref="OperationHistoryService"/> for one-click Undo.
/// </summary>
public sealed class FileOrganizerService
{
    public const string OrganizeFolderOperationId = "maintenance.organize_folder";

    private readonly SafeOperationEngine _safeOperationEngine;

    private sealed record FileMoveEntry(string SourcePath, string DestinationPath);
    private sealed record OrganizePayload(string RootFolderPath, List<FileMoveEntry> Moves);

    public static SystemOperationDescriptor OrganizeFolderDescriptor { get; } = new(
        OperationTypeId: OrganizeFolderOperationId,
        DisplayName: "Organize Folder by File Category",
        Category: "Maintenance / File Organizer",
        Description: "Moves loose top-level files in a folder (such as Downloads) into categorized subfolders (Documents, Images, Videos, Audio, Archives, Installers, Code) with full one-click Undo support.",
        Reversibility: OperationReversibility.Reversible,
        RiskLevel: OperationRiskLevel.Low,
        ElevationRequirement: OperationElevationRequirement.StandardUser,
        PotentialRisks:
        [
            "Recent file shortcuts in applications that point to the old top-level path may need to open the file from its new category subfolder.",
            "Can be undone with one click from Operation History."
        ],
        VerificationMethodDescription: "Verifies that all scheduled files exist at their target category subfolder paths after moving.",
        RollbackMethodDescription: "Moves every organized file back to its original top-level path and removes empty category subfolders.");

    public FileOrganizerService(SafeOperationEngine? safeOperationEngine = null)
    {
        _safeOperationEngine = safeOperationEngine ?? new SafeOperationEngine();
        _safeOperationEngine.RegisterHandler(new RegisteredOperationHandler(
            Descriptor: OrganizeFolderDescriptor,
            ExecuteAsync: ExecuteOrganizeAsync,
            RollbackAsync: RollbackOrganizeAsync));
    }

    public SafeOperationEngine SafeOperations => _safeOperationEngine;

    public static string? ClassifyExtension(string? extension)
    {
        if (string.IsNullOrWhiteSpace(extension))
        {
            return null;
        }

        return extension.ToLowerInvariant() switch
        {
            ".pdf" or ".doc" or ".docx" or ".txt" or ".rtf" or ".xls" or ".xlsx" or ".ppt" or ".pptx" or ".csv" or ".md" or ".epub" => "Documents",
            ".jpg" or ".jpeg" or ".png" or ".gif" or ".webp" or ".bmp" or ".svg" or ".ico" or ".heic" or ".tiff" => "Images",
            ".mp4" or ".mkv" or ".mov" or ".avi" or ".webm" or ".wmv" => "Videos",
            ".mp3" or ".wav" or ".flac" or ".ogg" or ".m4a" or ".aac" => "Audio",
            ".zip" or ".rar" or ".7z" or ".tar" or ".gz" or ".bz2" or ".xz" => "Archives",
            ".exe" or ".msi" or ".msix" or ".appx" or ".iso" => "Installers",
            ".json" or ".xml" or ".yaml" or ".yml" or ".sql" or ".py" or ".cs" or ".js" or ".ts" or ".html" or ".css" => "Code_And_Data",
            _ => null
        };
    }

    public FileOrganizePlan PreviewFolderOrganization(string folderPath)
    {
        if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
        {
            return new FileOrganizePlan(folderPath ?? string.Empty, [], 0, new Dictionary<string, int>(), DateTimeOffset.UtcNow);
        }

        var fullRoot = Path.GetFullPath(folderPath);
        if (PolicyEngine.IsProtectedSystemDirectory(fullRoot))
        {
            throw new InvalidOperationException($"Refusing to organize protected system directory: {fullRoot}");
        }

        var candidates = new List<FileOrganizeCandidateItem>();
        var categoryCounts = new Dictionary<string, int>(StringComparer.OrdinalIgnoreCase);
        long totalBytes = 0;

        foreach (var filePath in Directory.EnumerateFiles(fullRoot, "*", SearchOption.TopDirectoryOnly))
        {
            try
            {
                var info = new FileInfo(filePath);
                if (!info.Exists)
                {
                    continue;
                }

                // Skip hidden, system, reparse points, shortcuts, and active browser partial downloads
                if ((info.Attributes & (FileAttributes.Hidden | FileAttributes.System | FileAttributes.ReparsePoint)) != 0)
                {
                    continue;
                }

                var ext = info.Extension;
                if (string.Equals(ext, ".lnk", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ext, ".url", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ext, ".ini", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ext, ".crdownload", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ext, ".part", StringComparison.OrdinalIgnoreCase) ||
                    string.Equals(ext, ".tmp", StringComparison.OrdinalIgnoreCase))
                {
                    continue;
                }

                var category = ClassifyExtension(ext);
                if (string.IsNullOrEmpty(category))
                {
                    continue;
                }

                var destDir = Path.Combine(fullRoot, category);
                var destPath = GetNonCollidingDestinationPath(destDir, info.Name);

                candidates.Add(new FileOrganizeCandidateItem(
                    SourceFilePath: info.FullName,
                    FileName: info.Name,
                    CategoryFolder: category,
                    DestinationFilePath: destPath,
                    SizeBytes: info.Length));

                totalBytes += info.Length;
                categoryCounts[category] = categoryCounts.TryGetValue(category, out var c) ? c + 1 : 1;
            }
            catch
            {
                // Skip unreadable files.
            }
        }

        return new FileOrganizePlan(
            RootFolderPath: fullRoot,
            Candidates: candidates,
            TotalBytes: totalBytes,
            CategoryCounts: categoryCounts,
            CreatedAtUtc: DateTimeOffset.UtcNow);
    }

    public OperationProposal ProposeOrganizeFolder(string folderPath)
    {
        FileOrganizePlan plan;
        string? error = null;
        try
        {
            plan = PreviewFolderOrganization(folderPath);
        }
        catch (Exception ex)
        {
            plan = new FileOrganizePlan(folderPath ?? string.Empty, [], 0, new Dictionary<string, int>(), DateTimeOffset.UtcNow);
            error = ex.Message;
        }

        var moves = plan.Candidates
            .Select(c => new FileMoveEntry(c.SourceFilePath, c.DestinationFilePath))
            .ToList();

        var payload = new OrganizePayload(plan.RootFolderPath, moves);
        var payloadJson = JsonSerializer.Serialize(payload);

        var categorySummary = plan.CategoryCounts.Count > 0
            ? string.Join(", ", plan.CategoryCounts.Select(kvp => $"{kvp.Key}: {kvp.Value}"))
            : "No matching loose files found";

        return _safeOperationEngine.CreateProposal(
            descriptor: OrganizeFolderDescriptor,
            targetDescription: $"Organize Folder: {plan.RootFolderPath} ({plan.Candidates.Count} files)",
            inspectedCurrentStateSummary: $"Found {plan.Candidates.Count} loose file(s) ({plan.TotalBytes / (1024.0 * 1024.0):F2} MB) across categories: {categorySummary}.",
            preChangeStateJson: payloadJson,
            proposedChangeExplanation: $"Move {plan.Candidates.Count} loose file(s) in '{plan.RootFolderPath}' into category subfolders ({categorySummary}) and record all source paths for one-click Undo.",
            expectedEffects:
            [
                $"Organizes {plan.Candidates.Count} file(s) into {plan.CategoryCounts.Count} category subfolder(s).",
                "Preserves full source-to-destination mapping in Operation History for instant Undo."
            ],
            payloadJson: payloadJson,
            customPrerequisiteValidator: () =>
            {
                if (!string.IsNullOrEmpty(error))
                {
                    return (false, error);
                }
                if (string.IsNullOrWhiteSpace(folderPath) || !Directory.Exists(folderPath))
                {
                    return (false, $"Target folder '{folderPath}' does not exist.");
                }
                if (plan.Candidates.Count == 0)
                {
                    return (false, $"No loose files matching organization categories were found in '{folderPath}'.");
                }
                return (true, "Folder contains valid organization candidates.");
            });
    }

    private Task<(bool Succeeded, string PostStateSummary, string StatusMessage, OperationVerificationResult Verification)> ExecuteOrganizeAsync(
        string payloadJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<OrganizePayload>(payloadJson)
            ?? throw new InvalidOperationException("Invalid file organize payload.");

        var movedCount = 0;
        var verifiedCount = 0;

        foreach (var move in payload.Moves)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!File.Exists(move.SourcePath))
            {
                continue;
            }

            var destDir = Path.GetDirectoryName(move.DestinationPath);
            if (!string.IsNullOrWhiteSpace(destDir))
            {
                Directory.CreateDirectory(destDir);
            }

            File.Move(move.SourcePath, move.DestinationPath, overwrite: false);
            movedCount++;

            if (File.Exists(move.DestinationPath) && !File.Exists(move.SourcePath))
            {
                verifiedCount++;
            }
        }

        var allVerified = movedCount > 0 && verifiedCount == movedCount;
        var verification = new OperationVerificationResult(
            IsVerified: allVerified,
            ObservedStateSummary: $"Moved {movedCount} file(s); verified {verifiedCount} at destination.",
            VerificationDetails: $"Organized '{payload.RootFolderPath}': {verifiedCount}/{payload.Moves.Count} files verified in category subfolders.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: allVerified,
            PostStateSummary: verification.ObservedStateSummary,
            StatusMessage: allVerified
                ? $"Successfully organized {movedCount} file(s) in '{payload.RootFolderPath}'."
                : $"Organized {movedCount} of {payload.Moves.Count} file(s).",
            Verification: verification));
    }

    private Task<(bool Succeeded, string StatusMessage, OperationVerificationResult Verification)> RollbackOrganizeAsync(
        string preChangeStateJson,
        CancellationToken cancellationToken)
    {
        cancellationToken.ThrowIfCancellationRequested();
        var payload = JsonSerializer.Deserialize<OrganizePayload>(preChangeStateJson)
            ?? throw new InvalidOperationException("Invalid file organize rollback payload.");

        var restoredCount = 0;
        var touchedCategoryDirs = new HashSet<string>(StringComparer.OrdinalIgnoreCase);

        foreach (var move in payload.Moves)
        {
            cancellationToken.ThrowIfCancellationRequested();
            if (!File.Exists(move.DestinationPath))
            {
                continue;
            }

            var sourceDir = Path.GetDirectoryName(move.SourcePath);
            if (!string.IsNullOrWhiteSpace(sourceDir))
            {
                Directory.CreateDirectory(sourceDir);
            }

            var catDir = Path.GetDirectoryName(move.DestinationPath);
            if (!string.IsNullOrWhiteSpace(catDir))
            {
                touchedCategoryDirs.Add(catDir);
            }

            if (!File.Exists(move.SourcePath))
            {
                File.Move(move.DestinationPath, move.SourcePath, overwrite: false);
                if (File.Exists(move.SourcePath))
                {
                    restoredCount++;
                }
            }
        }

        foreach (var catDir in touchedCategoryDirs)
        {
            try
            {
                if (Directory.Exists(catDir) && !Directory.EnumerateFileSystemEntries(catDir).Any())
                {
                    Directory.Delete(catDir, recursive: false);
                }
            }
            catch
            {
                // Ignore if directory is non-empty or locked.
            }
        }

        var ok = restoredCount > 0;
        var verification = new OperationVerificationResult(
            IsVerified: ok,
            ObservedStateSummary: $"Restored {restoredCount} file(s) back to '{payload.RootFolderPath}'.",
            VerificationDetails: $"Verified {restoredCount}/{payload.Moves.Count} file(s) exist at their original top-level paths.",
            VerifiedAtUtc: DateTimeOffset.UtcNow);

        return Task.FromResult((
            Succeeded: ok,
            StatusMessage: ok
                ? $"Undid folder organization: restored {restoredCount} file(s) to '{payload.RootFolderPath}'."
                : "No organized files were found to restore.",
            Verification: verification));
    }

    private static string GetNonCollidingDestinationPath(string destDir, string fileName)
    {
        var candidate = Path.Combine(destDir, fileName);
        if (!File.Exists(candidate))
        {
            return candidate;
        }

        var baseName = Path.GetFileNameWithoutExtension(fileName);
        var ext = Path.GetExtension(fileName);
        for (var i = 1; i < 1000; i++)
        {
            var alt = Path.Combine(destDir, $"{baseName} ({i}){ext}");
            if (!File.Exists(alt))
            {
                return alt;
            }
        }

        return Path.Combine(destDir, $"{baseName}_{Guid.NewGuid():N}{ext}");
    }
}
