using System;
using System.Collections.Generic;
using System.ComponentModel;
using System.IO;
using System.Text.Json;
using Microsoft.UI.Xaml;

namespace Groundwork.Desktop;

// XAML-generated type info requires public parameterless constructors and settable properties.

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

public sealed class StorageBarSegmentViewModel
{
    public string Name { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public double Percent { get; set; }
    public string ColorHex { get; set; } = "#6F91FF";
    public string TooltipText => $"{Name}: {FormattedSize} ({Percent:F1}%)";
}

public sealed class StorageTreeNodeViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    public int Id { get; set; }
    public int ParentId { get; set; }
    public string Name { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public bool IsDirectory { get; set; }
    public long SizeBytes { get; set; }
    public long AllocatedBytes { get; set; }
    public int RecursiveFileCount { get; set; }
    public int RecursiveFolderCount { get; set; }
    public string FormattedSize { get; set; } = string.Empty;
    public string FormattedAllocated { get; set; } = string.Empty;
    public string ItemsSummary { get; set; } = string.Empty;
    public string LastModifiedFormatted { get; set; } = string.Empty;
    public double PercentOfDrive { get; set; }
    public string PercentLabel { get; set; } = string.Empty;
    public double PercentOfParent { get; set; }
    public string PercentOfParentLabel { get; set; } = string.Empty;
    public string FilesCountFormatted => IsDirectory ? $"{RecursiveFileCount:N0}" : "-";
    public string FoldersCountFormatted => IsDirectory ? $"{RecursiveFolderCount:N0}" : "-";
    public string Attributes { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public int DepthLevel { get; set; }
    public Thickness IndentThickness => new(DepthLevel * 16, 0, 0, 0);

    private bool _isExpanded;
    public bool IsExpanded
    {
        get => _isExpanded;
        set
        {
            if (_isExpanded != value)
            {
                _isExpanded = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsExpanded)));
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ExpanderGlyph)));
            }
        }
    }

    public bool HasChildren => IsDirectory && (RecursiveFolderCount > 0 || RecursiveFileCount > 0);
    public Microsoft.UI.Xaml.Visibility HasChildrenVisibility => HasChildren ? Microsoft.UI.Xaml.Visibility.Visible : Microsoft.UI.Xaml.Visibility.Collapsed;
    public string ExpanderGlyph => IsExpanded ? "\uE70D" : "\uE76C"; // ChevronDown / ChevronRight
    public string Glyph { get; set; } = string.Empty;
    public string GlyphColor { get; set; } = string.Empty;
    public string NodeGlyph => !string.IsNullOrEmpty(Glyph) ? Glyph : (IsDirectory ? "\uE8B7" : "\uE8A5");
    public string NodeGlyphColor => !string.IsNullOrEmpty(GlyphColor) ? GlyphColor : (IsDirectory ? "#6F91FF" : "#94A3B8");

    public StorageTreeNodeViewModel() { }
}

public sealed class FileRowViewModel
{
    public string Name { get; set; } = string.Empty;
    public string Extension { get; set; } = string.Empty;
    public string FileType { get; set; } = string.Empty;
    public string Folder { get; set; } = string.Empty;
    public string FullPath { get; set; } = string.Empty;
    public string Category { get; set; } = string.Empty;
    public long SizeBytes { get; set; }
    public long AllocatedBytes { get; set; }
    public string FormattedSize { get; set; } = string.Empty;
    public string FormattedAllocated { get; set; } = string.Empty;
    public double PercentOfTotal { get; set; }
    public string PercentLabel { get; set; } = string.Empty;
    public string LastModifiedFormatted { get; set; } = string.Empty;
    public string Attributes { get; set; } = string.Empty;
    public string Glyph { get; set; } = "\uE8A5";
    public string GlyphColor { get; set; } = "#6F91FF";

    public FileRowViewModel() { }

    public FileRowViewModel(string Name, string FullPath, string Category, string FormattedSize, string FormattedAllocated, long SizeBytes)
    {
        this.Name = Name;
        this.FullPath = FullPath;
        this.Category = Category;
        this.FormattedSize = FormattedSize;
        this.FormattedAllocated = FormattedAllocated;
        this.SizeBytes = SizeBytes;
        this.Extension = System.IO.Path.GetExtension(FullPath).ToLowerInvariant();
        this.Folder = System.IO.Path.GetDirectoryName(FullPath) ?? string.Empty;
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

public sealed class DuplicateGroupCardViewModel
{
    public string Sha256 { get; set; } = string.Empty;
    public string Sha256Short => Sha256.Length > 16 ? Sha256[..16] + "..." : Sha256;
    public string FormattedSize { get; set; } = string.Empty;
    public string SummaryText { get; set; } = string.Empty;
    public long PotentialWasteBytes { get; set; }
    public string FormattedWaste { get; set; } = string.Empty;
    public List<DuplicateItemRowViewModel> Files { get; set; } = [];
}

public sealed class DuplicateItemRowViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;
    private bool _isSelected;
    public bool IsSelected
    {
        get => _isSelected;
        set
        {
            if (_isSelected != value)
            {
                _isSelected = value;
                PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(IsSelected)));
            }
        }
    }
    public string FullPath { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string FormattedSize { get; set; } = string.Empty;
    public string ModifiedDate { get; set; } = string.Empty;
    public bool IsHardLinkAlias { get; set; }
    public string StatusBadge { get; set; } = string.Empty;
    public string StatusBadgeBackground { get; set; } = string.Empty;
    public string StatusBadgeForeground { get; set; } = string.Empty;
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
    public string IconPngPath { get; set; } = string.Empty;
    public bool HasIcon => !string.IsNullOrEmpty(IconPngPath);
    public Groundwork.Engine.Models.InstalledApplicationInfo? RawModel { get; set; }

    public InstalledAppRowViewModel() { }

    public InstalledAppRowViewModel(string Id, string Name, string Publisher, string Version, string InstallDate, string InstallLocation, string FormattedSize, string UninstallString, bool CanUninstall, Groundwork.Engine.Models.InstalledApplicationInfo RawModel, string IconPngPath = "")
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
        this.IconPngPath = string.IsNullOrEmpty(IconPngPath) ? (RawModel?.IconPngPath ?? "") : IconPngPath;
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

public sealed class AppSettingsModel
{
    public string ThemeMode { get; set; } = "Dark";
    public string DefaultScanPath { get; set; } = @"C:\";
    public int ParallelThreads { get; set; } = Math.Clamp(Environment.ProcessorCount, 2, 16);
    public bool AlwaysRecycleBin { get; set; } = true;
    public bool ConfirmBeforeDelete { get; set; } = true;
    public string AiProvider { get; set; } = "builtin";
    public string OllamaUrl { get; set; } = "http://127.0.0.1:11434";
    public string ExcludedExtensions { get; set; } = ".tmp,.bak,.log";
    public string ExcludedPaths { get; set; } = @"$Recycle.Bin,System Volume Information";
}

public static class AppSettingsService
{
    private static readonly string SettingsDir = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "Groundwork");
    private static readonly string SettingsFile = Path.Combine(SettingsDir, "settings.json");
    private static AppSettingsModel? _cached;

    public static AppSettingsModel Load()
    {
        if (_cached != null) return _cached;
        try
        {
            if (File.Exists(SettingsFile))
            {
                string json = File.ReadAllText(SettingsFile);
                var settings = JsonSerializer.Deserialize<AppSettingsModel>(json);
                if (settings != null)
                {
                    _cached = settings;
                    return settings;
                }
            }
        }
        catch { }

        _cached = new AppSettingsModel();
        return _cached;
    }

    public static void Save(AppSettingsModel settings)
    {
        _cached = settings;
        try
        {
            Directory.CreateDirectory(SettingsDir);
            string json = JsonSerializer.Serialize(settings, new JsonSerializerOptions { WriteIndented = true });
            File.WriteAllText(SettingsFile, json);
        }
        catch { }
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

public sealed class ItemMetadataViewModel : INotifyPropertyChanged
{
    public event PropertyChangedEventHandler? PropertyChanged;

    private string _name = "No item selected";
    public string Name
    {
        get => _name;
        set { _name = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Name))); }
    }

    private string _fullPath = string.Empty;
    public string FullPath
    {
        get => _fullPath;
        set { _fullPath = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(FullPath))); }
    }

    private string _kindLabel = "Select a folder or file to inspect properties";
    public string KindLabel
    {
        get => _kindLabel;
        set { _kindLabel = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(KindLabel))); }
    }

    private string _formattedSize = "-";
    public string FormattedSize
    {
        get => _formattedSize;
        set { _formattedSize = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(FormattedSize))); }
    }

    private string _exactBytes = "-";
    public string ExactBytes
    {
        get => _exactBytes;
        set { _exactBytes = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ExactBytes))); }
    }

    private string _formattedAllocated = "-";
    public string FormattedAllocated
    {
        get => _formattedAllocated;
        set { _formattedAllocated = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(FormattedAllocated))); }
    }

    private string _itemsSummary = "-";
    public string ItemsSummary
    {
        get => _itemsSummary;
        set { _itemsSummary = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(ItemsSummary))); }
    }

    private string _createdDate = "-";
    public string CreatedDate
    {
        get => _createdDate;
        set { _createdDate = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(CreatedDate))); }
    }

    private string _lastModifiedDate = "-";
    public string LastModifiedDate
    {
        get => _lastModifiedDate;
        set { _lastModifiedDate = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(LastModifiedDate))); }
    }

    private string _attributes = "-";
    public string Attributes
    {
        get => _attributes;
        set { _attributes = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Attributes))); }
    }

    private bool _hasSelection;
    public bool HasSelection
    {
        get => _hasSelection;
        set { _hasSelection = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(HasSelection))); }
    }

    private string _glyph = "\uE8B7";
    public string Glyph
    {
        get => _glyph;
        set { _glyph = value; PropertyChanged?.Invoke(this, new PropertyChangedEventArgs(nameof(Glyph))); }
    }
}
