using System;

namespace Groundwork.Desktop;

// XAML-generated type info requires public parameterless constructors and settable properties,
// so these are plain classes (not records / required / init-only members).

public sealed class VolumeRowViewModel
{
    public string RootPath { get; set; } = string.Empty;
    public string VolumeName { get; set; } = string.Empty;
    public string FileSystemLabel { get; set; } = string.Empty;
    public string CapacitySummary { get; set; } = string.Empty;
    public double UsedPercent { get; set; }
    public string MftBadge { get; set; } = string.Empty;

    public VolumeRowViewModel() { }

    public VolumeRowViewModel(string RootPath, string VolumeName, string FileSystemLabel, string CapacitySummary, double UsedPercent, string MftBadge)
    {
        this.RootPath = RootPath;
        this.VolumeName = VolumeName;
        this.FileSystemLabel = FileSystemLabel;
        this.CapacitySummary = CapacitySummary;
        this.UsedPercent = UsedPercent;
        this.MftBadge = MftBadge;
    }
}

public sealed class FileRowViewModel
{
    public string Name { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public string FormattedAllocated { get; set; } = string.Empty;
    public long SizeBytes { get; set; }

    public FileRowViewModel() { }

    public FileRowViewModel(string Name, string FullPath, string Category, string FormattedSize, string FormattedAllocated, long SizeBytes)
    {
        this.Name = Name;
        this.FullPath = FullPath;
        this.Category = Category;
        this.FormattedSize = FormattedSize;
        this.FormattedAllocated = FormattedAllocated;
        this.SizeBytes = SizeBytes;
    }
}

public sealed class FolderRowViewModel
{
    public string Name { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public string FileCountLabel { get; set; } = string.Empty;
    public long SizeBytes { get; set; }

    public FolderRowViewModel() { }

    public FolderRowViewModel(string Name, string FullPath, string FormattedSize, string FileCountLabel, long SizeBytes)
    {
        this.Name = Name;
        this.FullPath = FullPath;
        this.FormattedSize = FormattedSize;
        this.FileCountLabel = FileCountLabel;
        this.SizeBytes = SizeBytes;
    }
}

public sealed class CategoryRowViewModel
{
    public string Label { get; set; } = string.Empty;
    public string SummaryText { get; set; } = string.Empty;
    public double SharePercent { get; set; }

    public CategoryRowViewModel() { }

    public CategoryRowViewModel(string Label, string SummaryText, double SharePercent)
    {
        this.Label = Label;
        this.SummaryText = SummaryText;
        this.SharePercent = SharePercent;
    }
}

public sealed class CleanupCandidateRowViewModel
{
    public bool IsSelected { get; set; } = true;
    public string Name { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string RuleName { get; set; } = string.Empty;
    public string Confidence { get; set; } = string.Empty;
    public string Reason { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}

public sealed class InstalledAppRowViewModel
{
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Publisher { get; set; } = string.Empty;
    public string Version { get; set; } = string.Empty;
    public string InstallDate { get; set; } = string.Empty;
    public string InstallLocation { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public string UninstallString { get; set; } = string.Empty;
    public bool CanUninstall { get; set; }
    public Groundwork.Engine.Models.InstalledApplicationInfo? RawModel { get; set; }

    public InstalledAppRowViewModel() { }

    public InstalledAppRowViewModel(string Id, string Name, string Publisher, string Version, string InstallDate, string InstallLocation, string FormattedSize, string UninstallString, bool CanUninstall, Groundwork.Engine.Models.InstalledApplicationInfo RawModel)
    {
        this.Id = Id;
        this.Name = Name;
        this.Publisher = Publisher;
        this.Version = Version;
        this.InstallDate = InstallDate;
        this.InstallLocation = InstallLocation;
        this.FormattedSize = FormattedSize;
        this.UninstallString = UninstallString;
        this.CanUninstall = CanUninstall;
        this.RawModel = RawModel;
    }
}

public sealed class LeftoverItemRowViewModel
{
    public bool IsSelected { get; set; }
    public string FullPath { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string LocationGroup { get; set; } = string.Empty;
    public string Confidence { get; set; } = string.Empty;
    public string Evidence { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
}

public sealed class SavedSearchRowViewModel
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string QueryText { get; set; } = string.Empty;
    public string Mode { get; set; } = string.Empty;

    public SavedSearchRowViewModel() { }

    public SavedSearchRowViewModel(string Id, string Title, string QueryText, string Mode)
    {
        this.Id = Id;
        this.Title = Title;
        this.QueryText = QueryText;
        this.Mode = Mode;
    }
}

public sealed class SearchResultRowViewModel
{
    public string FileName { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public string Snippet { get; set; } = string.Empty;
    public string ScoreLabel { get; set; } = string.Empty;

    public SearchResultRowViewModel() { }

    public SearchResultRowViewModel(string FileName, string FullPath, string FileType, string Snippet, string ScoreLabel)
    {
        this.FileName = FileName;
        this.FullPath = FullPath;
        this.FileType = FileType;
        this.Snippet = Snippet;
        this.ScoreLabel = ScoreLabel;
    }
}

public sealed class NoteRowViewModel
{
    public string Id { get; set; } = string.Empty;
    public string Title { get; set; } = string.Empty;
    public string Content { get; set; } = string.Empty;
    public string UpdatedAt { get; set; } = string.Empty;

    public NoteRowViewModel() { }

    public NoteRowViewModel(string Id, string Title, string Content, string UpdatedAt)
    {
        this.Id = Id;
        this.Title = Title;
        this.Content = Content;
        this.UpdatedAt = UpdatedAt;
    }
}

public static class ByteFormatter
{
    public static string FormatBytes(long? bytes)
    {
        if (bytes == null)
        {
            return "Unknown";
        }
        long b = Math.Max(0, bytes.Value);
        string[] units = ["B", "KB", "MB", "GB", "TB"];
        double val = b;
        int idx = 0;
        while (val >= 1024.0 && idx < units.Length - 1)
        {
            val /= 1024.0;
            idx++;
        }
        return idx == 0 ? $"{b:N0} B" : $"{val:F1} {units[idx]}";
    }
}
